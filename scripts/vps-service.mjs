import path from 'node:path';
import { startVpsService } from '../src/vps-service.mjs';

const directory=path.resolve(process.env.WA_DATA_DIRECTORY||'/var/lib/whatsapp-manutencao');
const port=process.env.WA_PORT||'8787';
const publicBase=process.env.WA_PUBLIC_BASE_URL||null;
const service=await startVpsService({directory,port,publicBase});
let closing=false;
async function shutdown(code=0){if(closing)return;closing=true;try{await service.close();}finally{process.exit(code);}}
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());
process.on('uncaughtException',()=>void shutdown(1));
process.on('unhandledRejection',()=>void shutdown(1));