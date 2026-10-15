export function normalizeProfile(value) {
  if(!value||!['male','female'].includes(value.sex))return null;
  const name=typeof value.name==='string'?value.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,30):'';
  const numeric=value=>Number(String(value??'').replace(',','.'));
  const age=numeric(value.age),height=numeric(value.height),weight=numeric(value.weight);
  if(!name||!Number.isInteger(age)||age<16||age>100||!Number.isFinite(height)||height<120||height>230||!Number.isFinite(weight)||weight<35||weight>250)return null;
  return {name,sex:value.sex,age,height,weight};
}
