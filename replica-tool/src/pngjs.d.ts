// pngjs non pubblica tipi ufficiali: dichiarazione minima sufficiente all'uso che ne facciamo.
declare module "pngjs" {
  export class PNG {
    width: number;
    height: number;
    data: Buffer;
    constructor(opts?: { width?: number; height?: number });
    static sync: {
      read(buf: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}
