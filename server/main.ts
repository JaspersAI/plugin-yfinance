import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.ts'

// What the yfinance/server connection runs: the server over stdio. Yahoo Finance needs no key.

const server = createServer()
await server.connect(new StdioServerTransport())
