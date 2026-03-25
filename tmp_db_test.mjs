import{PrismaClient}from'@prisma/client';const p=new PrismaClient();try{await p['\x24connect']();console.log('DB OK');await p['\x24disconnect']();}catch(e){console.log('DB FAIL:',e.message);}
