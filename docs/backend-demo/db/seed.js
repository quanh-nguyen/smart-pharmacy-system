'use strict';
const {createDbPool,seedDemo}=require('../server');
(async()=>{
 const pool=createDbPool();
 try{await seedDemo(pool);console.log('Demo fixtures ready (no existing records overwritten).');}
 finally{await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
