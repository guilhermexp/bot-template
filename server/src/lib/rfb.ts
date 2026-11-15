/** Incremental, bounded client RFB parser. Watch permits negotiation and frame reads only. */
const MAX_MESSAGE = 1024 * 1024;
export class WatchFilter {
  private buffer = Buffer.alloc(20);
  private used = 0;
  private failed = false;
  feed(chunk: Buffer): Buffer {
    if (this.failed) throw new Error('RFB stream rejected');
    const out: Buffer[] = [];
    let offset = 0;
    try {
      while (offset < chunk.length) {
        // Read only the header until its declared message size is known.
        const header = this.used ? headerLength(this.buffer[0]) : 1;
        const target = this.used >= header ? messageLength(this.buffer) : header;
        if (target < 1 || target > MAX_MESSAGE) throw new Error('RFB message rejected');
        if (this.buffer.length < target) {
          const next = Buffer.alloc(target);this.buffer.copy(next,0,0,this.used);this.buffer=next;
        }
        const count = Math.min(target-this.used,chunk.length-offset);
        chunk.copy(this.buffer,this.used,offset,offset+count);this.used+=count;offset+=count;
        const fullHeader = headerLength(this.buffer[0]);
        if (this.used < fullHeader) continue;
        const size = messageLength(this.buffer);
        if (size < 1 || size > MAX_MESSAGE) throw new Error('RFB message rejected');
        if (this.used < size) continue;
        if ([0,2,3,150,248].includes(this.buffer[0])) out.push(Buffer.from(this.buffer.subarray(0,size)));
        this.used=0;
      }
      return Buffer.concat(out);
    } catch {
      this.failed=true;this.buffer=Buffer.alloc(0);this.used=0;
      throw new Error('RFB stream rejected');
    }
  }
}
function headerLength(t:number):number {
  switch(t){case 0:return 1;case 2:return 4;case 3:case 4:case 5:case 150:return 1;case 6:return 8;case 248:return 9;case 251:return 8;default:throw new Error('RFB unknown message');}
}
function messageLength(b:Buffer):number {
  switch(b[0]){
    case 0:return 20;case 2:return 4+4*b.readUInt16BE(2);case 3:return 10;
    case 4:return 8;case 5:return 6;case 6:return 8+Math.abs(b.readInt32BE(4));
    case 150:return 10;case 248:return 9+b[8];case 251:return 8+16*b[6];
    default:return -1;
  }
}
