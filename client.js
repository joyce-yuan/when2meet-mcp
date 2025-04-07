const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const readline = require('readline');

// Create a command-line interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log("Starting When2Meet MCP client...");
  
  // Create client transport using the documented approach
  const transport = new StdioClientTransport({
    command: "node",
    args: ["when2meet-server.js"]
  });
  
  // Create client with capabilities
  const client = new Client(
    {
      name: "when2meet-client",
      version: "1.0.0"
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {}
      }
    }
  );
  
  try {
    // Connect to the server
    console.log("Connecting to the server...");
    await client.connect(transport);
    console.log("Connected to When2Meet MCP server!");
    
    // Get the When2Meet URL from the user
    const eventUrl = await askQuestion(rl, "\nEnter the When2Meet URL: ");
    
    // Get details about the When2Meet event
    console.log("Fetching event details...");
    const eventDetails = await client.callTool({
      name: "get-event-details",
      arguments: {
        eventUrl: eventUrl
      }
    });
    
    console.log(`\nEvent: ${eventDetails.name}`);
    console.log(`Date Range: ${eventDetails.dateRange}`);
    
    // Generate the availability prompt
    console.log("\nGenerating availability options...");
    const promptResult = await client.callTool({
      name: "generate-availability-prompt",
      arguments: {
        eventDetails: eventDetails
      }
    });
    
    // Display the prompt to the user
    console.log("\n" + promptResult.selectionPrompt);
    
    // Get the user's selections
    const selections = await askQuestion(rl, "Your selections: ");
    
    // Parse the selections
    console.log("\nParsing your selections...");
    const parsedSelections = await client.callTool({
      name: "parse-availability-selections",
      arguments: {
        selections: selections,
        promptData: {
          dayGroups: promptResult.dayGroups,
          slotLookup: promptResult.slotLookup
        }
      }
    });
    
    // Show the selected timestamps and their details
    console.log("\nSelected time slots:");
    if (parsedSelections.readableSelections && parsedSelections.readableSelections.length > 0) {
      parsedSelections.readableSelections.forEach(selection => {
        console.log(`  ${selection}`);
      });
      
      console.log("\nRaw timestamps selected:");
      console.log(parsedSelections.timestamps);
      
      // Confirm before marking availability
      const shouldMark = await askQuestion(rl, "\nDo you want to mark these times on When2Meet? (yes/no): ");
      
      if (shouldMark.toLowerCase() === 'yes') {
        const userName = await askQuestion(rl, "Enter your name for When2Meet: ");
        const usePassword = await askQuestion(rl, "Do you need a password? (yes/no): ");
        
        let password = '';
        if (usePassword.toLowerCase() === 'yes') {
          password = await askQuestion(rl, "Enter your password: ");
        }
        
        // Mark availability on When2Meet
        console.log("\nMarking your availability on When2Meet...");
        try {
          const markResult = await client.callTool({
            name: "mark-when2meet-availability",
            arguments: {
              eventUrl: eventUrl,
              userName: userName,
              password: password,
              timestamps: parsedSelections.timestamps
            }
          });
          
          console.log(`\nMarked ${markResult.markedCount} slots as available`);
          if (markResult.failures && markResult.failures.length > 0) {
            console.log(`Failed to mark ${markResult.failures.length} slots`);
          }
          console.log(`You can see the results at: ${markResult.resultUrl || eventUrl}`);
        } catch (error) {
          console.error("\nError marking availability:", error.message || error);
        }
      }
    } else {
      console.log("No time slots were selected. Please try again with valid selections.");
    }
  } catch (error) {
    console.error("Error:", error.message || error);
  } finally {
    // Clean up
    rl.close();
    await transport.close();
  }
}

// Helper function to ask a question and return the answer
function askQuestion(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer);
    });
  });
}

main().catch(console.error);