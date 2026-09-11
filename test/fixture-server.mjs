import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../src/server.mjs';
import { Reader } from '../src/core.mjs';
import { fixtures, fixtureAccess } from './fixtures.mjs';
const provider=fixtures();
if(process.argv.includes('--fail')) provider.chat=async()=>{throw new Error('SECRET_FIXTURE_DO_NOT_LEAK');};
const server=createMcpServer(new Reader(provider,{access:fixtureAccess(),cooldownMs:0}));
await server.connect(new StdioServerTransport());
