const panel=document.getElementById("panel");
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");panel.textContent="panel "+(b.dataset.tab==="1"?"one":"two");});
document.getElementById("openm").onclick=()=>document.getElementById("m").showModal();
document.getElementById("closem").onclick=()=>document.getElementById("m").close();
document.getElementById("nav").onclick=()=>{history.pushState({},"","/about");document.getElementById("app").dataset.route="about";};
