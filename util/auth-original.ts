import {
    AsgardeoAuthClient,
    AuthClientConfig,
    Storage,
    StorageManager,
    Crypto,
    JWKInterface,
    TokenResponse,
    ExtendedAuthorizeRequestUrlParams,
    initializeEmbeddedSignInFlow,
    EmbeddedSignInFlowInitiateResponse,
    executeEmbeddedSignInFlow,
    EmbeddedFlowExecuteRequestConfig,
    EmbeddedSignInFlowHandleResponse,
    EmbeddedSignInFlowStatus,
} from "@asgardeo/javascript";
import base64url from "base64url";
import sha256 from "fast-sha256";
import * as jose from "jose";
import randombytes from "secure-random-bytes";

interface AgentConfig {
    agentID: string;
    agentSecret: string;
}

export interface AuthCodeResponse {
    code: string;
    state: string;
    session_state: string;
}

class CacheStore implements Storage {
    private cache: Map<string, string> = new Map();

    public async setData(key: string, value: string): Promise<void> {
        this.cache.set(key, value);
    }

    public async getData(key: string): Promise<string> {
        return this.cache.get(key) ?? "{}";
    }

    public async removeData(key: string): Promise<void> {
        this.cache.delete(key);
    }
}

class CryptoUtils implements Crypto<Buffer | string> {
    public constructor() {}

    public base64URLEncode(value: Buffer | string): string {
        return base64url.encode(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }

    public base64URLDecode(value: string): string {
        return base64url.decode(value).toString();
    }

    public hashSha256(data: string): string | Buffer {
        return Buffer.from(sha256(new TextEncoder().encode(data)));
    }

    public generateRandomBytes(length: number): string | Buffer {
        return randombytes(length);
    }

    public async verifyJwt(
        idToken: string,
        jwk: Partial<JWKInterface>,
        algorithms: string[],
        clientId: string,
        issuer: string,
        subject: string,
        clockTolerance?: number,
    ): Promise<boolean> {
        const key: jose.CryptoKey | Uint8Array = await jose.importJWK(jwk);
        return jose
            .jwtVerify(idToken, key, {
                algorithms,
                audience: clientId,
                clockTolerance,
                issuer,
                subject,
            })
            .then(() => Promise.resolve(true));
    }
}

export class AsgardeoAgentAuth<T> {
    private auth: AsgardeoAuthClient<T>;

    private cryptoUtils: Crypto;

    private store: Storage;

    private storageManager: StorageManager<T>;

    private baseURL: string;

    constructor(config: AuthClientConfig<T>) {
        this.store = new CacheStore();
        this.cryptoUtils = new CryptoUtils();
        this.auth = new AsgardeoAuthClient();
        this.auth.initialize(config, this.store, this.cryptoUtils);
        this.storageManager = this.auth.getStorageManager();

        this.baseURL = config.baseUrl ?? "";
    }

    // Build Authorize request
    public async getAuthURL(customParams?: ExtendedAuthorizeRequestUrlParams): Promise<string> {
        const authURL: string | undefined = await this.auth.getSignInUrl(customParams);

        if (authURL) {
            return Promise.resolve(authURL.toString());
        }
        return Promise.reject(new Error("Could not build Authorize URL"));
    }

    // Get Agent Token. (AI agent acting on its own)
    public async getAgentToken(agentConfig: AgentConfig): Promise<TokenResponse> {
        const customParam = {
            response_mode: "direct",
        };
        const authorizeURL: URL = new URL(await this.getAuthURL(customParam));

        const authorizeResponse: EmbeddedSignInFlowInitiateResponse = await initializeEmbeddedSignInFlow({
            url: `${authorizeURL.origin}${authorizeURL.pathname}`,
            payload: Object.fromEntries(authorizeURL.searchParams.entries()),
        });

        const usernamePasswordAuthenticator = authorizeResponse.nextStep.authenticators.find(
            (auth) => auth.authenticator === "Username & Password",
        );

        if (!usernamePasswordAuthenticator) {
            return Promise.reject(new Error("Basic authenticator not found among authentication steps."));
        }

        const authnRequest: EmbeddedFlowExecuteRequestConfig = {
            baseUrl: this.baseURL,
            payload: {
                flowId: authorizeResponse.flowId,
                selectedAuthenticator: {
                    authenticatorId: usernamePasswordAuthenticator.authenticatorId,
                    params: {
                        username: agentConfig.agentID,
                        password: agentConfig.agentSecret,
                    },
                },
            },
        };

        const authnResponse: EmbeddedSignInFlowHandleResponse = await executeEmbeddedSignInFlow(authnRequest);

        if (authnResponse.flowStatus != EmbeddedSignInFlowStatus.SuccessCompleted) {
            return Promise.reject(new Error("Agent Authentication Failed."));
        }

        return this.auth.requestAccessToken(
            authnResponse.authData.code,
            authnResponse.authData.session_state,
            authnResponse.authData.state,
        );
    }

    // Build Authorize request for the OBO Flow
    public async getOBOFlowAuthURL(agentConfig: AgentConfig): Promise<string> {
        // The authorize request must include requested_actor parameter from the agent configs
        const customParam = {
            requested_actor: agentConfig.agentID,
        };

        // Build authorize URL using AsgardeoAuthClient
        const authURL: string | undefined = await this.auth.getSignInUrl(customParam);

        if (authURL) {
            return Promise.resolve(authURL.toString());
        }
        return Promise.reject(new Error("Could not build Authorize URL"));
    }

    // Get OBO Token. (AI agent acting on behalf of a user)
    public async getOBOToken(agentConfig: AgentConfig, authCodeResponse: AuthCodeResponse): Promise<TokenResponse> {
        // Get Agent Token
        const agentToken = await this.getAgentToken(agentConfig);

        // Pass Agent Token when requesting access token
        const tokenRequestConfig = {
            params: {
                actor_token: agentToken.accessToken,
            },
        };

        // Return OBO Token
        return await this.auth.requestAccessToken(
            authCodeResponse.code,
            authCodeResponse.session_state,
            authCodeResponse.state,
            undefined,
            tokenRequestConfig
        );
    }
}
