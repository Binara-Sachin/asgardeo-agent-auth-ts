import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

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

const model = new ChatGoogleGenerativeAI({
    apiKey: "",
    model: "gemini-2.5-flash",
});

async function runAgent() {
    // 1. Get Agent Token
    const asgardeoAgentAuth = new AsgardeoAgentAuth(asgardeoConfig);
    const agentToken = await asgardeoAgentAuth.getAgentToken(agentConfig);

    // 2. Setup the Multi-Server MCP Client and pass the received access token in Authorization header.
    const client = new MultiServerMCPClient({
        math: {
            transport: "http",
            url: "http://localhost:3000/mcp",
            headers: {
                Authorization: "Bearer " + agentToken.accessToken,
            },
        },
    });

    // 3. Connect and Convert MCP Tools to LangChain Tools
    const tools = await client.getTools();

    // 4. Create the Agent
    const agent = createReactAgent({
        llm: model,
        tools: tools,
    });

    // 5. Setup the interface to read input
    const rl = readline.createInterface({ input, output });
    console.log("--- AI Agent Started (Type 'exit' to quit) ---");

    while (true) {
        try {
            // 6. Ask the user for their prompt
            const userInput = await rl.question("You: ");

            if (userInput.toLowerCase() === "exit") {
                console.log("Goodbye!");
                break;
            }

            // 7. Run the Agent
            const result = await agent.invoke({
                messages: [{ role: "user", content: userInput }],
            });

            // 8. Print the Answer
            const finalResponse = result.messages[result.messages.length - 1];
            console.log("Agent: " + finalResponse.content);
        } catch (error) {
            console.error("Error running agent:", error);
            break;
        }
    }

    // 9. Cleanup
    await client.close();
    rl.close();
}

runAgent().catch(console.error);
