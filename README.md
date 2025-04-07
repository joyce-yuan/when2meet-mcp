# When2Meet MCP Server

A Model Context Protocol (MCP) server that helps users interact with When2Meet scheduling services. This server provides tools to retrieve event details, parse natural language availability descriptions, and automatically mark availability on When2Meet websites.

## Installation

```bash
npm install
```

Required dependencies:
- @modelcontextprotocol/sdk
- puppeteer
- zod

## Running the Server

```bash
node when2meet-server.js
```

This starts the MCP server using stdio transport, making it compatible with any MCP client.

## Available Tools

### 1. get-event-details

Retrieves information about a When2Meet event from its URL.

**Input:**
- `eventUrl`: String - The full URL of the When2Meet event

**Output:**
- Event name
- Date range
- Available time slots formatted by day
- URL information

### 2. parse-availability-text

Converts natural language availability descriptions into timestamps that can be used to mark availability.

**Input:**
- `availabilityText`: String - Natural language description (e.g., "I'm available on Monday afternoons and all day Wednesday")
- `eventDetails`: Object - The event details from get-event-details

**Output:**
- Parsed timestamps that match the described availability

### 3. mark-when2meet-availability

Marks specific time slots as available on the When2Meet website.

**Input:**
- `eventUrl`: String - The When2Meet URL
- `userName`: String - Name to use for the When2Meet login
- `password`: String (optional) - Password if required
- `timestamps`: Array of Numbers - The timestamps to mark as available

**Output:**
- Count of successfully marked time slots
- Result URL

## Example Usage with an MCP Client

```javascript
const { McpClient } = require('@modelcontextprotocol/sdk/client/mcp.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function main() {
  // Start the when2meet server as a child process
  const serverProc = spawn('node', ['when2meet.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
  
  // Create client that talks to the server
  const transport = new StdioClientTransport(serverProc.stdout, serverProc.stdin);
  const client = new McpClient();
  await client.connect(transport);
  
  // Get details about a When2Meet event
  const eventDetails = await client.callTool("get-event-details", {
    eventUrl: "https://www.when2meet.com/?29973029-asio2"
  });
  
  console.log(`Event: ${eventDetails.name}`);
  console.log(`Date Range: ${eventDetails.dateRange}`);
  
  // Parse natural language availability
  const availabilityResult = await client.callTool("parse-availability-text", {
    availabilityText: "I can do Monday afternoons and all day Wednesday",
    eventDetails: eventDetails
  });
  
  console.log(`Parsed ${availabilityResult.timestamps.length} time slots`);
  
  // Mark availability on When2Meet
  const markResult = await client.callTool("mark-when2meet-availability", {
    eventUrl: "https://www.when2meet.com/?29973029-asio2",
    userName: "TestUser",
    timestamps: availabilityResult.timestamps
  });
  
  console.log(`Marked ${markResult.markedCount} slots as available`);
  
  // Clean up
  serverProc.kill();
}

main().catch(console.error);
```

## Testing

For debugging, there's a test function that can be run directly:

```bash
# Uncomment the testWithSpecificTimestamps() call and comment out the main() call
node when2meet-server.js
```

This will test the server with specific timestamps on a test When2Meet URL.