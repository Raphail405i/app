export type Project = {id:string;name:string;client:string;color:string;budget:number;currency:string};
export type Change = {id:string;projectId:string;title:string;description:string;amount:number;currency:string;days:number;status:'draft'|'pending'|'approved'|'declined';createdAt:string;clientName?:string;decisionName?:string|null;decidedAt?:string|null};
export type Activity = {id:string;text:string;createdAt:string};
export type Workspace = {projects:Project[];requests:Change[];activities:Activity[]};
export type User = {id:string;name:string;email:string;plan:'free'|'pro'};
const ago=(days:number)=>new Date(Date.now()-days*86400000).toISOString();
export const demo:Workspace={projects:[
{id:'p1',name:'Brand & website',client:'Layers Studio',color:'purple',budget:6400,currency:'EUR'},
{id:'p2',name:'Summer campaign',client:'Olive & Co.',color:'orange',budget:4200,currency:'EUR'},
{id:'p3',name:'Mobile app design',client:'Orbit',color:'blue',budget:8500,currency:'EUR'}],requests:[
{id:'r1',projectId:'p1',title:'Additional landing page',description:'Design and development of one additional landing page, including responsive layouts and one revision round.',amount:850,currency:'EUR',days:3,status:'pending',createdAt:ago(0)},
{id:'r2',projectId:'p2',title:'Social media asset pack',description:'12 additional campaign assets for Instagram and LinkedIn.',amount:480,currency:'EUR',days:2,status:'approved',createdAt:ago(1),clientName:'Alex Morgan'},
{id:'r3',projectId:'p3',title:'Onboarding flow exploration',description:'Three additional onboarding concepts and an interactive prototype.',amount:1200,currency:'EUR',days:4,status:'pending',createdAt:ago(2)},
{id:'r4',projectId:'p1',title:'Extended brand guidelines',description:'A detailed usage guide for the new visual identity.',amount:650,currency:'EUR',days:2,status:'approved',createdAt:ago(4),clientName:'Jamie Chen'},
{id:'r5',projectId:'p2',title:'Motion design add-on',description:'Two short animated campaign loops.',amount:320,currency:'EUR',days:1,status:'draft',createdAt:ago(6)},
{id:'r6',projectId:'p3',title:'Dark mode screens',description:'Dark theme variants for the core product screens.',amount:1320,currency:'EUR',days:3,status:'approved',createdAt:ago(8),clientName:'Taylor Lee'}],activities:[
{id:'a1',text:'Alex approved Social media asset pack',createdAt:ago(1)},
{id:'a2',text:'You sent Additional landing page to Layers Studio',createdAt:ago(0)},
{id:'a3',text:'Jamie approved Extended brand guidelines',createdAt:ago(4)}]};
export function money(amount:number,currency='EUR'){return new Intl.NumberFormat('en-IE',{style:'currency',currency,minimumFractionDigits:Number.isInteger(amount)?0:2,maximumFractionDigits:2}).format(amount);}
export function date(value:string){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(value));}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-Scopeboard-Client':'web',...options.headers}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.error||'Something went wrong. Please try again.');
 return body as T;
}
