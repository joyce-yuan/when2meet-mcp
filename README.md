# When2Meet MCP Server

An AI-powered scheduling assistant that automates When2Meet availability marking through the Model Context Protocol (MCP). This tool helps users extract event details, select time slots, and automatically mark availability on When2Meet scheduling polls.

## Features

- 🔍 **Extract Event Details**: Automatically scrape and parse When2Meet events 
- 🗣️ **Smart Time Selection**: Select time slots using natural language, codes, or direct timestamps
- 🤖 **Automated Availability Marking**: Mark your availability without manual clicking
- 🔌 **MCP Integration**: Connect with any AI assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io/)

## Quick Start

### Installation

```bash
git clone https://github.com/joyce-yuan/when2meet-mcp.git
cd when2meet-mcp
npm install
```

### Running the MCP Server

```bash
node when2meet-server.js
```

### Running the MCP Client for Testing

```bash
node client.js
```

## Supported Tools

### 1. `get-event-details`

Extracts information from any When2Meet URL.

```javascript
// Example response
{
  "name": "Team Meeting",
  "dateRange": "April 7-9, 2025",
  "availableTimeslots": {
    // Structured time slot data with timestamps
  }
}
```

### 2. `generate-availability-prompt`

Creates a structured selection prompt with all available time slots.

```
[d0t0] 9:00 AM (1744549200)
[d0t1] 9:15 AM (1744550100)
```

### 3. `parse-availability-selections`

Converts selections into actual timestamps using multiple input formats:
- Slot codes (`d0t0 d1t2`)
- Time patterns (`morning0 day1`)
- Direct timestamps (`1744549200, 1744550100`)

### 4. `mark-when2meet-availability`

Automatically marks your availability on When2Meet using browser automation.

## Example Client Usage

```javascript
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

// Create client transport
const transport = new StdioClientTransport({
  command: "node",
  args: ["when2meet-server.js"]
});

// Initialize client
const client = new Client(
  { name: "when2meet-client", version: "1.0.0" },
  { capabilities: { prompts: {}, resources: {}, tools: {} } }
);

// Connect and use tools
await client.connect(transport);

// Get event details
const eventDetails = await client.callTool({
  name: "get-event-details",
  arguments: { eventUrl: "https://www.when2meet.com/your-event-id" }
});

// Mark availability
await client.callTool({
  name: "mark-when2meet-availability", 
  arguments: {
    eventUrl: "https://www.when2meet.com/your-event-id",
    userName: "Your Name",
    timestamps: [1744549200, 1744550100]
  }
});
```

## Use Cases

- **AI Assistant Integration**: Let AI assistants handle scheduling for you
- **Automated Scheduling**: Schedule meetings without manual intervention
- **Natural Language Scheduling**: Express availability in plain English
- **Bulk Availability Marking**: Mark multiple time slots at once

## Requirements

- Node.js 18+
- @modelcontextprotocol/sdk (^1.8.0)
- puppeteer
- zod

## License

MIT

## Upcoming Integrations
- Support for Google Calendar direct scheduling