import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { Server } from "http";

import express from "express";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

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

const model = new ChatGoogleGenerativeAI({
    apiKey: "",
    model: "gemini-2.5-flash",
});

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

    // 6. Setup the Multi-Server MCP Client and pass the received access token in Authorization header.
    const client = new MultiServerMCPClient({
        math: {
            transport: "http",
            url: "http://localhost:3000/mcp",
            headers: {
                Authorization: "Bearer " + oboToken.accessToken,
            },
        },
    });

    // 7. Connect and Convert MCP Tools to LangChain Tools
    const tools = await client.getTools();

    // 8. Create the Agent
    const agent = createReactAgent({
        llm: model,
        tools: tools,
    });

    // 9. Setup the interface to read input
    const rl = readline.createInterface({ input, output });
    console.log("--- AI Agent Started (Type 'exit' to quit) ---");

    while (true) {
        try {
            // 10. Ask the user for their prompt
            const userInput = await rl.question("You: ");

            if (userInput.toLowerCase() === "exit") {
                console.log("Goodbye!");
                break;
            }

            // 11. Run the Agent
            const result = await agent.invoke({
                messages: [{ role: "user", content: userInput }],
            });

            // 12. Print the Answer
            const finalResponse = result.messages[result.messages.length - 1];
            console.log("Agent: " + finalResponse.content);
        } catch (error) {
            console.error("Error running agent:", error);
            break;
        }
    }

    // 13. Cleanup
    await client.close();
    rl.close();
}

runAgent().catch(console.error);
