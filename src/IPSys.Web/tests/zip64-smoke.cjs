'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {TextEncoder}=require('node:util');
const source=fs.readFileSync('src/IPSys.Web/wwwroot/export.js','utf8');
const marker='return {start,cancel,makePlan,cleanName,crcStep,isActive:()=>!!active};';
assert.equal(source.split(marker).length,2,'export surface marker changed');
const exposed=source.slice(0,source.indexOf('globalThis.IPSysExport=IPSysExport;'))
 .replace(marker,marker.replace('};',' ,localHeader,descriptor,centralHeader,endHeader};'));
const z=vm.runInNewContext(exposed+'\nIPSysExport;',{
 TextEncoder,Uint8Array,Uint32Array,DataView,Date,BigInt,Map,Set
});
const view=x=>new DataView(x.buffer,x.byteOffset,x.byteLength);
const date=new Date('2026-10-17T12:00:00Z');
const big=2**32+12345;
const local=z.localHeader('over-4GB.bin',date,true),l=view(local);
assert.equal(l.getUint32(0,true),0x04034b50);
assert.equal(l.getUint16(4,true),45);
assert.equal(l.getUint32(18,true),0xffffffff);
assert.equal(l.getUint16(28,true),20);
assert.equal(l.getUint16(30+'over-4GB.bin'.length,true),1);
const desc=z.descriptor(big,0x12345678,true),d=view(desc);
assert.equal(desc.byteLength,24);
assert.equal(d.getBigUint64(8,true),BigInt(big));
assert.equal(d.getBigUint64(16,true),BigInt(big));
const central=z.centralHeader({name:'over-4GB.bin',date,size:big,
 crc:0x12345678,offset:big+8192},true),c=view(central);
assert.equal(c.getUint32(0,true),0x02014b50);
assert.equal(c.getUint16(6,true),45);
assert.equal(c.getUint32(20,true),0xffffffff);
const p=46+'over-4GB.bin'.length;
assert.equal(c.getUint16(p,true),1);
assert.equal(c.getUint16(p+2,true),24);
assert.equal(c.getBigUint64(p+4,true),BigInt(big));
assert.equal(c.getBigUint64(p+20,true),BigInt(big+8192));
const tail=z.endHeader(65536,big,123456789,true),t=view(tail);
assert.equal(tail.byteLength,98);
assert.equal(t.getUint32(0,true),0x06064b50);
assert.equal(t.getBigUint64(24,true),65536n);
assert.equal(t.getBigUint64(40,true),123456789n);
assert.equal(t.getBigUint64(48,true),BigInt(big));
assert.equal(t.getUint32(56,true),0x07064b50);
assert.equal(t.getBigUint64(64,true),BigInt(big+123456789));
assert.equal(t.getUint32(76,true),0x06054b50);
assert.equal(t.getUint16(84,true),0xffff);
assert.equal(t.getUint32(88,true),0xffffffff);
// Old small files must stay plain ZIP32 for backwards compatibility.
assert.equal(z.localHeader('small.txt',date).byteLength,39);
assert.equal(z.descriptor(7,99).byteLength,16);
assert.equal(z.centralHeader({name:'small.txt',date,size:7,crc:99,offset:0}).byteLength,55);
assert.equal(z.endHeader(1,50,55).byteLength,22);
console.log('ZIP64 BIGINT RECORD SMOKE PASS');
