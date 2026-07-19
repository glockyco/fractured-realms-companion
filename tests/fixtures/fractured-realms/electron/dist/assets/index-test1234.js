const Xe={update(fn){return fn(this);},subscribe(fn){return fn;}};
function tr(value){return value;}
function Er(){}
function Ii(a,t){
  const r=tr(Xe);
  Er(),Xe.update(s=>({...s,activeSkill:a,activeAction:t??null}));
  if (a) emit("skill_started");
}
