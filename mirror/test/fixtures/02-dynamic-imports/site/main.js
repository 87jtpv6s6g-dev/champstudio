const map=["chunk.js"];
const d=(i)=>map[i];
import(/* @vite-ignore */ "/"+d(0)).then(m=>{document.getElementById("out").textContent=m.hello();});
