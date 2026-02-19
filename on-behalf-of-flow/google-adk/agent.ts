import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { Server } from "http";

import "dotenv/config";
import express from "express";
import { LlmAgent, MCPToolset, InMemoryRunner } from "@google/adk";

import { AsgardeoAgentAuth, AuthCodeResponse } from "./util/auth";

const port = '3001';

const asgardeoConfig = {
    afterSignInUrl: "http://localhost:3001/callback",
    clientId: "",
    baseUrl: "https://api.asgardeo.io/t/" + "",
};

const agentConfig = {
    agentID: "",
    agentSecret: "",
};

async function runAgent() {
    const asgardeoAgentAuth = new AsgardeoAgentAuth(asgardeoConfig);

    // 1. Prompt the user to log in through browser
    const authURL = await asgardeoAgentAuth.getOBOFlowAuthURL(agentConfig);
    console.log("Open this URL in your browser to authenticate: " + authURL);

    // 2. Create a simple express server to catch the authorization code upon redirect.
    const app = express();
    let server: Server;

    let authCodeResponse: AuthCodeResponse | undefined;

    const authCodePromise = new Promise<AuthCodeResponse>((resolve) => {
        app.get("/callback", async (req, res) => {
            try {
                const code = req.query.code as string;
                const session_state = req.query.session_state as string;
                const state = req.query.state as string;

                if (!code) {
                    res.status(400).send("No authorization code found.");
                    Promise.reject(new Error("No authorization code found."));
                }

                console.log("Authorization Code received. Code: " + code);

                authCodeResponse = {
                    code: code,
                    state: state,
                    session_state: session_state,
                };

                resolve(authCodeResponse);

                // Send response to browser
                res.send("<h1>Login Successful!</h1><p>You can close this window.</p>");
            } catch (err) {
                res.status(500).send("Internal Server Error");
            } finally {
                // Close the server regardless of success or failure once request is handled
                if (server) {
                    server.close(() => console.log("Local server closed."));
                }
            }
        });
    });

    // 3. Start the server and listen to port
    server = app
        .listen(port, () => {
            console.log(`Waiting on port ${port}...`);
        })
        .on("error", (error) => {
            console.error("Server error:", error);
            process.exit(1);
        });

    // 4. Wait for the authorization code to be received
    authCodeResponse = await authCodePromise;

    // 5. Exchange the auth code for a token using OBO flow
    const oboToken = await asgardeoAgentAuth.getOBOToken(agentConfig, authCodeResponse);

    // 2. Define LLM Agent
    const rootAgent = new LlmAgent({
        name: "example_agent",
        model: "gemini-2.5-flash",
        instruction: `You are a helpful AI assistant.`,
        tools: [
            new MCPToolset({
                type: "StreamableHTTPConnectionParams",
                url: "http://localhost:3000/mcp",
                header: {
                    Authorization: `Bearer ${oboToken.accessToken}`,
                },
            }),
        ],
    });

    // 3. Initiate Runner with the Agent
    const runner = new InMemoryRunner({
        agent: rootAgent,
        appName: "my-custom-app",
    });

    // 4. Create a session for the user
    const userId = "user-123";
    const session = await runner.sessionService.createSession({
        appName: "my-custom-app",
        userId: userId,
    });

    console.log(`Session created: ${session.id}`);

    // 5. Capture user input
    const rl = readline.createInterface({ input, output });
    console.log("--- AI Agent Started (Type 'exit' to quit) ---");

    while (true) {
        const userInput = await rl.question("You: ");

        if (userInput.toLowerCase() === "exit") {
            console.log("Goodbye!");
            break;
        }

        // 6. Define the User Message from input
        const userMessage = {
            role: "user",
            parts: [{ text: userInput }],
        };

        // 7. Run the agent loop
        // runAsync returns an async generator that yields events (thoughts, tool calls, responses)
        const eventStream = runner.runAsync({
            userId: userId,
            sessionId: session.id,
            newMessage: userMessage,
        });

        // 8. Consume events
        try {
            for await (const event of eventStream) {
                // Check if the event has text content to display
                if (event.content && event.content.parts) {
                    const text = event.content.parts.map((p) => p.text).join("");
                    if (text) {
                        console.log(`Agent : ${text}`);
                    }
                }
            }
        } catch (error) {
            console.error("Error running agent:", error);
        }
    }

    rl.close();
}

runAgent().catch(console.error);
