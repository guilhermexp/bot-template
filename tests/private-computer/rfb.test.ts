import test from 'node:test';import assert from 'node:assert/strict';import {WatchFilter} from '../../server/src/lib/rfb.js';
test('watch drops fragmented key, pointer and clipboard while permitting frame requests',()=>{
 const key=Buffer.from([4,1,0,0,0,0,0,65]),mouse=Buffer.from([5,1,0,1,0,2]),clip=Buffer.from([6,0,0,0,0,0,0,3,97,98,99]),frame=Buffer.from([3,0,0,0,0,0,0,8,0,8]);
 const stream=Buffer.concat([key,mouse,clip,frame]); const f=new WatchFilter();const out:Buffer[]=[];
 for(const b of stream)out.push(f.feed(Buffer.from([b])));assert.deepEqual(Buffer.concat(out),frame);
 assert.throws(()=>f.feed(Buffer.from([255])),/RFB/);
});
test('watch permanently rejects an unknown message instead of resynchronizing input',()=>{
 const f=new WatchFilter();assert.throws(()=>f.feed(Buffer.from([255])),/RFB/);
 assert.throws(()=>f.feed(Buffer.from([3,0,0,0,0,0,0,8,0,8])),/RFB/);
});
test('watch rejects oversized clipboard before buffering its declared payload',()=>{
 const f=new WatchFilter();assert.throws(()=>f.feed(Buffer.from([6,0,0,0,127,255,255,255])),/RFB/);
});
test('watch parses large batches incrementally and drops desktop resize',()=>{
 const frame=Buffer.from([3,0,0,0,0,0,0,8,0,8]);const batch=Buffer.concat(Array(150000).fill(frame));assert.deepEqual(new WatchFilter().feed(batch),batch);
 const resize=Buffer.from([251,0,4,0,3,0,0,0]);assert.equal(new WatchFilter().feed(resize).length,0);
});
