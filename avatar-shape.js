export function bodyShape(level,profile={height:175,weight:78}) {
  const trained=Math.min(1,Math.max(0,(level-8)/52));
  const height=Number(profile.height)||175,weight=Number(profile.weight)||78;
  const softness=Math.min(.50,Math.max(.12,((weight/(height/100)**2)-20)/25));
  return {trained,softness:softness*(1-trained*.65),stage:level<8?'Начало пути':level<20?'Входишь в ритм':level<40?'Набираешь форму':level<60?'Уверенный ритм':'Новый облик'};
}
