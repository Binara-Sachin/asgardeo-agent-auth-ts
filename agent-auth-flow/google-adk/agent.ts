import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

import "dotenv/config";
import { LlmAgent, MCPToolset, InMemoryRunner } from "@google/adk";

import { AsgardeoAgentAuth } from "./util/auth";

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
    // 1. Get Agent Token
    const asgardeoAgentAuth = new AsgardeoAgentAuth(asgardeoConfig);
    const agentToken = await asgardeoAgentAuth.getAgentToken(agentConfig);

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
                    Authorization: `Bearer ${agentToken.accessToken}`,
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
