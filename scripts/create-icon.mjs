import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const size=256, pixels=Buffer.alloc((size*4+1)*size), points=[];
// Reuse Android's integral mark, rather than the coloured Electron logo.
function curve(a,b,c,d) { for(let i=0;i<=120;i++){const t=i/120,u=1-t;points.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]);} }
curve([67,27],[58,21],[53,28],[53,38]);for(let y=38;y<=69;y++)points.push([53,y]);curve([53,69],[53,80],[48,87],[40,81]);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const offset=y*(size*4+1)+1+x*4,px=x*108/size,py=y*108/size;
  const ink=points.some(([a,b])=>(px-a)**2+(py-b)**2<=2.5**2);pixels[offset]=pixels[offset+1]=pixels[offset+2]=ink?28:250;pixels[offset+3]=255;
}
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),body=Buffer.concat([name,data]),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([header,body,tail]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
await writeFile('public/mathmyth.png',png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
await writeFile('public/mathmyth.ico',Buffer.concat([ico,png]));
