/**
 * When2Meet MCP Server
 * 
 * This server provides tools to interact with When2Meet scheduling services through the Model Context Protocol.
 * It allows clients to extract event details, select time slots, and mark availability on When2Meet websites.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { HttpServerTransport } = require("@modelcontextprotocol/sdk/server/http.js");
const puppeteer = require("puppeteer");
const { z } = require("zod");

// Create MCP server
const server = new McpServer({
  name: "when2meet-availability-helper",
  version: "1.0.0",
  description: "MCP server for interacting with When2Meet scheduling services"
});

/**
 * Tool: get-event-details
 * Extracts event information from a When2Meet URL including name, dates, and available time slots.
 * 
 * @param {string} eventUrl - The full URL of the When2Meet event
 * @returns Event name, date range, and available time slots with timestamps
 */
server.tool(
  "get-event-details",
  { 
    eventUrl: z.string().url("Please provide a valid When2Meet URL")
  },
  async ({ eventUrl }) => {
    try {
      // Validate URL is from when2meet
      if (!eventUrl.includes("when2meet.com")) {
        throw new Error("The provided URL is not a When2Meet URL");
      }
      
      const eventDetails = await getWhen2MeetEventDetails(eventUrl);
      
      // Create a more detailed content response
      let contentText = `Event: ${eventDetails.name}\nDates: ${eventDetails.dateRange}\n`;
      
      // Add formatted availability information if available

      
      
      // Directly unravel all the data needed by generate-availability-prompt
      // const result = {
      //   content: [{
      //     type: "text",
      //     text: contentText
      //   }],
      //   name: eventDetails.name,
      //   dateRange: eventDetails.dateRange,
      //   url: eventDetails.url
      // };
      
      // // Add timeslot data directly to the top level
      // if (eventDetails.availableTimeslots) {
      //   result.availableTimeslots = eventDetails.availableTimeslots;
      //   result.dayGroups = eventDetails.availableTimeslots.dayGroups;
      //   result.allTimeslots = eventDetails.availableTimeslots.allTimeslots;
      //   result.formattedAvailability = eventDetails.availableTimeslots.formattedAvailability;
      // }

      // Convert eventDetails object to a string before returning
      const eventDetailsString = JSON.stringify(eventDetails);

      // Directly unravel all the data needed by generate-availability-prompt
      const result = {
        content: [{
          type: "text",
          text: eventDetailsString
        }],
        eventDetailsString: eventDetailsString
      };

      return result;
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error retrieving event details: ${error.message || "Unknown error"}`
        }],
        error: true,
        errorMessage: error.message || "Unknown error"
      };
    }
  }
);

/**
 * Tool: generate-availability-prompt
 * Creates a structured selection prompt with all available time slots and their timestamps.
 * 
 * @param {object} eventDetails - Event details from get-event-details tool
 * @returns Formatted prompt with time slot codes and timestamp information
 */
server.tool(
  "generate-availability-prompt",
  {
    eventDetails: z.object({
      name: z.string(),
      dateRange: z.string(),
      timeSlots: z.array(z.any()).optional(),
      availableTimeslots: z.record(z.any()).optional()
    })
  },
  async ({ eventDetails }) => {
    try {
      // Check if we have available time slots data
      if (!eventDetails.availableTimeslots || !eventDetails.availableTimeslots.dayGroups) {
        throw new Error("Event details are missing time slot information");
      }
      
      const days = eventDetails.availableTimeslots.dayGroups;
      const allSlots = eventDetails.availableTimeslots.allTimeslots;
      
      // Generate a formatted selection prompt for each day
      const dayPrompts = days.map((day, dayIndex) => {
        // Create a header for the day
        const dayHeader = `${day.fullDate} (${day.dayName}):\n`;
        
        // Get all time slots for this day
        const daySlots = day.slots.sort((a, b) => a.timestamp - b.timestamp);
        
        // Group time slots into 15-minute blocks
        const timeSlotGroups = [];
        for (let i = 0; i < daySlots.length; i++) {
          const slot = daySlots[i];
          const date = new Date(slot.timestamp * 1000);
          const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          
          timeSlotGroups.push({
            id: `d${dayIndex}t${i}`,
            timestamp: slot.timestamp,
            time: formattedTime,
            readableTime: slot.readableTime
          });
        }
        
        // Format the time slots for this day
        const timeSlotOptions = timeSlotGroups.map(slot => 
          `[${slot.id}] ${slot.time} (${slot.timestamp})`
        ).join('\n');
        
        return `${dayHeader}${timeSlotOptions}\n`;
      }).join('\n');
      
      // Build the complete prompt
      const selectionPrompt = `
Please select your available time slots for: ${eventDetails.name}

Enter the IDs of the time slots you're available for (e.g., d0t0 d1t2 d2t1):
${dayPrompts}

You can also use these shorthand options:
- To select all time slots for a day, enter: day{n} (e.g., day0 for the first day)
- To select all morning slots (before noon), enter: morning{n} (e.g., morning0)
- To select all afternoon slots (noon-5pm), enter: afternoon{n} (e.g., afternoon0)
- To select all evening slots (after 5pm), enter: evening{n} (e.g., evening0)

Or if you prefer, you can directly enter UTC timestamps separated by commas:
1744549200, 1744550100, 1744550100

Enter your selections (using any of the formats above):
`;
      
      // Create slot lookup tables for efficient parsing
      const slotLookup = {};
      days.forEach((day, dayIndex) => {
        day.slots.forEach((slot, slotIndex) => {
          const slotId = `d${dayIndex}t${slotIndex}`;
          slotLookup[slotId] = slot.timestamp;
        });
      });
      
      return {
        content: [{
          type: "text",
          text: selectionPrompt
        }],
        dayGroups: days,
        slotLookup,
        selectionPrompt
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error generating availability prompt: ${error.message || "Unknown error"}`
        }],
        error: true,
        errorMessage: error.message || "Unknown error"
      };
    }
  }
);

/**
 * Tool: parse-availability-selections
 * Converts selection codes or direct timestamps into actual When2Meet timestamps.
 * Handles multiple selection formats including day codes, time-of-day patterns, and direct timestamps.
 * 
 * @param {string} selections - User's selections (space or comma separated)
 * @param {object} promptData - Data from generate-availability-prompt tool
 * @returns Array of UTC timestamps and human-readable formatted times
 */
server.tool(
  "parse-availability-selections",
  {
    selections: z.string(),
    promptData: z.object({
      dayGroups: z.array(z.any()),
      slotLookup: z.record(z.number()).optional()
    })
  },
  async ({ selections, promptData }) => {
    try {
      const { dayGroups, slotLookup } = promptData;
      const selectedTimestamps = [];
      
      // Check if the user entered direct timestamps (comma-separated numbers)
      if (selections.match(/^\s*\d+\s*,\s*\d+/)) {
        // Parse comma-separated timestamps
        const timestampStrings = selections.split(',').map(s => s.trim());
        for (const tsStr of timestampStrings) {
          const timestamp = parseInt(tsStr, 10);
          if (!isNaN(timestamp)) {
            selectedTimestamps.push(timestamp);
          }
        }
      } else {
        // Parse the selections string (space-separated codes)
        const selectionParts = selections.trim().split(/\s+/);
        
        for (const selection of selectionParts) {
          // Check if it's a specific time slot (e.g., d0t2)
          const slotMatch = selection.match(/^d(\d+)t(\d+)$/i);
          if (slotMatch && slotLookup) {
            const slotId = selection.toLowerCase();
            if (slotLookup[slotId]) {
              selectedTimestamps.push(slotLookup[slotId]);
            }
            continue;
          }
          
          // Check if it's an entire day (e.g., day0)
          const dayMatch = selection.match(/^day(\d+)$/i);
          if (dayMatch) {
            const dayIndex = parseInt(dayMatch[1], 10);
            
            if (dayGroups[dayIndex]) {
              const allDayTimestamps = [];
              dayGroups[dayIndex].slots.forEach(slot => {
                allDayTimestamps.push(slot.timestamp);
              });
              selectedTimestamps.push(...allDayTimestamps);
            }
            continue;
          }
          
          // Check if it's a time of day (morning, afternoon, evening)
          const timeOfDayMatch = selection.match(/^(morning|afternoon|evening)(\d+)$/i);
          if (timeOfDayMatch) {
            const timeOfDay = timeOfDayMatch[1].toLowerCase();
            const dayIndex = parseInt(timeOfDayMatch[2], 10);
            
            if (dayGroups[dayIndex]) {
              const day = dayGroups[dayIndex];
              const filteredSlots = day.slots.filter(slot => {
                const date = new Date(slot.timestamp * 1000);
                const hour = date.getHours();
                
                if (timeOfDay === 'morning') {
                  return hour >= 6 && hour < 12; // 6am to 11:59am
                } else if (timeOfDay === 'afternoon') {
                  return hour >= 12 && hour < 17; // 12pm to 4:59pm
                } else if (timeOfDay === 'evening') {
                  return hour >= 17; // 5pm onwards
                }
                return false;
              });
              
              filteredSlots.forEach(slot => {
                selectedTimestamps.push(slot.timestamp);
              });
            }
          }
        }
      }
      
      // Remove duplicates
      const uniqueTimestamps = [...new Set(selectedTimestamps)];
      
      // Generate human-readable format of selected times
      const readableSelections = [];
      const timestampDetails = [];
      
      // Create detailed timestamp information
      uniqueTimestamps.forEach(timestamp => {
        const date = new Date(timestamp * 1000);
        
        // Find the slot in the original data to get its readable format
        let readableTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let originalFormat = null;
        
        for (const day of dayGroups) {
          const matchingSlot = day.slots.find(slot => slot.timestamp === timestamp);
          if (matchingSlot) {
            originalFormat = matchingSlot.readableTime;
            break;
          }
        }
        
        timestampDetails.push({
          timestamp,
          date: date.toLocaleDateString(),
          time: readableTime,
          originalFormat
        });
      });
      
      // Group by date
      const groupedByDate = {};
      timestampDetails.forEach(detail => {
        if (!groupedByDate[detail.date]) {
          groupedByDate[detail.date] = [];
        }
        groupedByDate[detail.date].push(detail);
      });
      
      // Format grouped timestamps
      Object.keys(groupedByDate).forEach(date => {
        const times = groupedByDate[date].map(detail => detail.time).join(', ');
        readableSelections.push(`${date}: ${times}`);
      });
      
      // Return both the timestamps and their details
      return {
        content: [{
          type: "text",
          text: `Selected ${uniqueTimestamps.length} time slots:\n${readableSelections.join('\n')}`
        }],
        timestamps: uniqueTimestamps,
        timestampDetails,
        readableSelections
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error parsing selections: ${error.message || "Unknown error"}`
        }],
        error: true,
        errorMessage: error.message || "Unknown error",
        timestamps: []
      };
    }
  }
);

/**
 * Tool: mark-when2meet-availability
 * Marks selected time slots as available on a When2Meet event.
 * Uses browser automation to log in and click on time slots.
 * 
 * @param {string} eventUrl - The When2Meet URL
 * @param {string} userName - Name to use for the When2Meet login
 * @param {string} password - Optional password if the event requires it
 * @param {number[]} timestamps - Array of UTC timestamps to mark as available
 * @returns Number of successfully marked time slots and result URL
 */
server.tool(
  "mark-when2meet-availability",
  {
    eventUrl: z.string().url("Please provide a valid When2Meet URL"),
    userName: z.string().min(1, "Username is required"),
    password: z.string().optional(),
    timestamps: z.array(z.number()).min(1, "At least one timestamp is required")
  },
  async ({ eventUrl, userName, password, timestamps }) => {
    try {
      // Validate URL is from when2meet
      if (!eventUrl.includes("when2meet.com")) {
        throw new Error("The provided URL is not a When2Meet URL");
      }
      
      const result = await markWhen2MeetAvailability(eventUrl, userName, password, timestamps);
      
      return {
        content: [{
          type: "text", 
          text: `Successfully marked ${result.markedCount} time slots as available.`
        }],
        ...result
      };
    } catch (error) {
      return {
        content: [{
          type: "text", 
          text: `Error marking availability: ${error.message || "Unknown error"}`
        }],
        error: true,
        errorMessage: error.message || "Unknown error"
      };
    }
  }
);

/**
 * Tool: help
 * Provides information about the available tools and how to use them.
 * 
 * @returns Description of all available tools
 */
server.tool(
  "help",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: `When2Meet MCP Server - Available Tools:

1. get-event-details
   - Extracts information from a When2Meet URL
   - Input: eventUrl (string)
   - Output: Event name, date range, available time slots

2. generate-availability-prompt
   - Creates a structured prompt for selecting time slots
   - Input: eventDetails (object from get-event-details)
   - Output: Selection prompt with time slot codes and timestamps

3. parse-availability-selections
   - Converts selection codes to actual timestamps
   - Input: selections (string), promptData (object)
   - Output: Array of timestamps and human-readable times

4. mark-when2meet-availability
   - Marks selected time slots as available on When2Meet
   - Input: eventUrl, userName, password (optional), timestamps
   - Output: Number of marked slots and result URL

Example workflow:
1. Get event details with get-event-details
2. Generate selection prompt with generate-availability-prompt
3. Convert selections to timestamps with parse-availability-selections
4. Mark availability with mark-when2meet-availability`
      }]
    };
  }
);

/**
 * Helper function to scrape When2Meet event details.
 * Uses Puppeteer to extract event name, date range, and time slot information.
 * 
 * @param {string} url - The When2Meet URL
 * @returns {object} Event details including name, date range, and available time slots
 */
async function getWhen2MeetEventDetails(url) {
  const browser = await puppeteer.launch({ 
    headless: "new",  // Use new headless mode
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // For running in various environments
  });
  
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Extract event name and date range
    const name = await page.$eval('title', el => (el.textContent || "").replace(' - When2Meet', ''));
    
    // Try different selectors for the date range
    let dateRange = "";
    try {
      // Try to find date information from any available source
      dateRange = await page.evaluate(() => {
        // Look for elements with date information
        const dateElements = [
          document.querySelector('.dateHeader'),
          document.querySelector('.timeHeader'),
          document.querySelector('#newTimeSlotsSection h2'),
          document.querySelector('h1'),
          // Try to extract from the title
          document.title ? document.title.replace(/ - When2Meet$/, '') : null
        ];
        
        // Try to find any element that contains date information
        for (const el of dateElements) {
          if (el && el.textContent) {
            return el.textContent.trim();
          }
        }
        
        return "Date information not found";
      });
    } catch (e) {
      console.log("Error extracting date range:", e);
      dateRange = "Date information not available";
    }
    
    // Get time slot information from GroupGridSlots and convert to user-friendly format
    const availableTimeslots = await page.evaluate(() => {
      const timeslots = [];
      
      // Find all time slot elements
      const slotElements = document.querySelectorAll('#GroupGridSlots [id^="GroupTime"]');
      
      slotElements.forEach(element => {
        // Extract UTC timestamp
        const timestamp = parseInt(element.getAttribute('data-time'), 10);
        
        // Extract readable time from mouseover event
        const onmouseover = element.getAttribute('onmouseover') || '';
        const timeMatch = onmouseover.match(/ShowSlot\(\d+,"([^"]+)"\)/);
        const readableTime = timeMatch ? timeMatch[1] : '';
        
        // Extract column (day) and row (time) position
        const col = parseInt(element.getAttribute('data-col'), 10);
        const row = parseInt(element.getAttribute('data-row'), 10);
        
        timeslots.push({
          timestamp,
          readableTime,
          col,
          row,
          elementId: element.id
        });
      });
      
      // Group slots by day (column) and organize into continuous time blocks
      const days = [];
      const maxCol = Math.max(...timeslots.map(slot => slot.col));
      
      // Helper function to format time from a timestamp
      const formatTime = (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      
      // Helper function to format date from a timestamp
      const formatDate = (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      };
      
      for (let col = 0; col <= maxCol; col++) {
        // Get all slots for this day and sort by row (time)
        const daySlots = timeslots.filter(slot => slot.col === col).sort((a, b) => a.row - b.row);
        
        if (daySlots.length > 0) {
          // Get day info from first slot
          const firstSlot = daySlots[0];
          const date = new Date(firstSlot.timestamp * 1000);
          const dayName = date.toLocaleDateString([], { weekday: 'long' });
          const fullDate = formatDate(firstSlot.timestamp);
          
          // Create time blocks by identifying continuous slots
          const timeBlocks = [];
          let currentBlock = null;
          
          daySlots.forEach((slot, index) => {
            const time = formatTime(slot.timestamp);
            
            // Create a new block if we don't have one
            if (!currentBlock) {
              currentBlock = {
                startTimestamp: slot.timestamp,
                endTimestamp: slot.timestamp,
                startTime: time,
                endTime: time,
                timestamps: [slot.timestamp]
              };
            } else {
              // Check if this slot is continuous with the current block
              // Get the expected timestamp for a continuous slot
              const prevSlot = daySlots[index - 1];
              const expectedNext = prevSlot.timestamp + 900; // 15 minutes = 900 seconds
              
              if (slot.timestamp === expectedNext) {
                // This is continuous, extend the block
                currentBlock.endTimestamp = slot.timestamp;
                currentBlock.endTime = time;
                currentBlock.timestamps.push(slot.timestamp);
              } else {
                // This is a new block, save the current one and start new
                timeBlocks.push(currentBlock);
                currentBlock = {
                  startTimestamp: slot.timestamp,
                  endTimestamp: slot.timestamp,
                  startTime: time,
                  endTime: time,
                  timestamps: [slot.timestamp]
                };
              }
            }
            
            // If this is the last slot, add the current block
            if (index === daySlots.length - 1 && currentBlock) {
              timeBlocks.push(currentBlock);
            }
          });
          
          days.push({
            dayName,
            fullDate,
            dayIndex: col,
            timeBlocks,
            slots: daySlots
          });
        }
      }
      
      // Create an array of formatted availability strings
      const formattedAvailability = days.map(day => {
        const blocks = day.timeBlocks.map(block => 
          `${block.startTime} - ${block.endTime}`
        ).join(', ');
        
        return `${day.fullDate}: ${blocks}`;
      });
      
      return {
        allTimeslots: timeslots,
        dayGroups: days,
        formattedAvailability
      };
    });
    
    await browser.close();
    
    return {
      name,
      dateRange,
      availableTimeslots,
      url
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Helper function to mark availability on When2Meet.
 * Uses Puppeteer to log in and click on time slots.
 * 
 * @param {string} url - The When2Meet URL
 * @param {string} userName - Name to use for login
 * @param {string} password - Optional password
 * @param {number[]} timestamps - Array of UTC timestamps to mark as available
 * @returns {object} Results including number of marked slots and any failures
 */
async function markWhen2MeetAvailability(url, userName, password = '', timestamps) {
  // Launch browser
  const browser = await puppeteer.launch({
    headless: false, // Set to true for production
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // For running in various environments
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a timeout for page operations
    page.setDefaultTimeout(60000); // 60 seconds
    
    // Navigate to the When2Meet URL
    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Log in
    console.log(`Logging in as ${userName}`);
    
    // Wait for the name input and ensure it's visible and enabled
    await page.waitForSelector('#name', { visible: true });
    
    // Clear the input field first (in case there's any default value)
    await page.evaluate(() => {
      document.getElementById('name').value = '';
    });
    
    // Type the name with a slight delay between keystrokes
    await page.type('#name', userName, { delay: 100 });
    
    // Verify the name was entered correctly
    const nameValue = await page.evaluate(() => document.getElementById('name').value);
    console.log(`Verified name input value: "${nameValue}"`);
    
    if (password) {
      await page.waitForSelector('#password', { visible: true });
      await page.type('#password', password, { delay: 100 });
    }
    
    // Ensure input event is fired (sometimes needed)
    await page.evaluate(() => {
      const nameInput = document.getElementById('name');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    // Find and click the Sign In button with a delay
    await page.click('input[value="Sign In"]');
    
    // Wait for the grid to load
    console.log('Waiting for grid to load');
    await page.waitForSelector('#YouGridSlots');
    
    // Mark the specified timestamps as available
    console.log(`Marking ${timestamps.length} time slots as available`);
    
    // Use page.evaluate to run code in browser context
    const result = await page.evaluate(async (timestamps) => {
      let markedCount = 0;
      let failures = [];
      
      // Process each timestamp with delays
      for (let i = 0; i < timestamps.length; i++) {
        const timestamp = timestamps[i];
        const elementId = `YouTime${timestamp}`;
        const element = document.getElementById(elementId);
        
        if (element) {
          try {
            // Mark as available (green)
            element.style.background = "rgb(222, 255, 222)";
            
            // Trigger mousedown event
            element.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window
            }));
            
            // Wait between events (need to use setTimeout in browser context)
            await new Promise(r => setTimeout(r, 100));
            
            // Trigger mouseup event
            element.dispatchEvent(new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window
            }));
            
            markedCount++;
          } catch (err) {
            failures.push({ timestamp, error: err.message || "Unknown error" });
          }
          
          // Wait before processing next timestamp
          if (i < timestamps.length - 1) {
            await new Promise(r => setTimeout(r, 150));
          }
        } else {
          failures.push({ timestamp, error: "Element not found" });
        }
      }
      
      return { markedCount, failures };
    }, timestamps);
    
    // Wait to ensure changes are saved
    console.log(`Marked ${result.markedCount} time slots, waiting for changes to save...`);
    await new Promise(r => setTimeout(r, 5000));
    
    // Get the resulting URL after submission
    const resultUrl = page.url();
    
    await browser.close();
    
    return {
      ...result,
      resultUrl
    };
  } catch (error) {
    console.error('Error:', error);
    await browser.close();
    throw error;
  }
}

// Start the server with stdio transport
async function main() {
  // Start with stdio transport for local development
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("When2Meet MCP server started with stdio transport");
  
  // Add HTTP server for Render deployment
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const PORT = process.env.PORT || 3000;
  
  const httpServer = http.createServer((req, res) => {
    // Handle MCP requests at /mcp endpoint
    if (req.url === '/mcp') {
      // Let the HttpServerTransport handle this request
      return;
    }
    else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'when2meet-mcp' }));
    } else if (req.url === '/' || req.url === '/index.html') {
      // Serve the HTML file
      const filePath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end(`Error loading index.html: ${err.message}`);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  // Start HTTP server
  httpServer.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });
  
  // Set up HTTP transport for MCP
  const httpTransport = new HttpServerTransport({
    server: httpServer,
    path: "/mcp"
  });
  
  // Connect the server to the HTTP transport
  await server.connect(httpTransport);
  console.log("MCP server connected to HTTP transport at /mcp endpoint");
}

// By default, run the MCP server
main().catch(error => {
  console.error("Error starting server:", error);
  process.exit(1);
});