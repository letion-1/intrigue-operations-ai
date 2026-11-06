/* INTRIGUE structured text intake: no AI call, no database access.
 * Only explicit labels and section rows are extracted. Unknown text is not guessed. */
export type Intake = { company?:Record<string,unknown>; workspace_services?:Record<string,unknown>[]; customers?:Record<string,unknown>[]; knowledge_entries?:Record<string,unknown>[] };
export type ParsedIntake = { data:Intake; structured:boolean; warnings:string[] };
const sections = new Set(['product catalog','products','services','service catalog','customers','company policies','policies','quotation policy','support hours','business hours','faq','faqs']);
function header(line:string):string {return line.toLowerCase().replace(/:$/,'').trim();}
function addKnowledge(rows:Record<string,unknown>[],name:string,lines:string[]){
  const content=lines.map(x=>x.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).join('\n');
  if(!content)return;
  for(let i=0;i<content.length;i+=3400)rows.push({title:name+(i?` (${Math.floor(i/3400)+1})`:''),category:name.toLowerCase().includes('faq')?'FAQ':'Policy',content:content.slice(i,i+3400)});
}
export function parseCompanyText(input:string):ParsedIntake{
  const source=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const lines=source.split('\n');
  const company:Record<string,unknown>={};
  const products:Record<string,unknown>[]=[];
  const customers:Record<string,unknown>[]=[];
  const knowledge:Record<string,unknown>[]=[];
  const warnings:string[]=[];
  const policySections:Record<string,string[]>={};
  let section=''; let recognized=0;
  const fieldMap:Record<string,string>={
    company:'company_name','company name':'company_name','business name':'company_name',
    industry:'industry',currency:'currency','business description':'description',description:'description',
    'what does your company do':'description','business email':'contact_email','support email':'contact_email',
    'contact email':'contact_email',phone:'phone',telephone:'phone',website:'website',
    timezone:'timezone','business timezone':'timezone',
    'business hours':'business_hours','support hours':'business_hours',
  };
  for(const raw of lines){
    const line=raw.trim();if(!line)continue;
    const possibleHeader=header(line);
    if(sections.has(possibleHeader)) {section=possibleHeader;recognized++;continue;}
    const pair=line.match(/^([A-Za-z][A-Za-z -]{1,38})\s*:\s*(.+)$/);
    if(pair && fieldMap[pair[1].toLowerCase().trim()]){
      const key=fieldMap[pair[1].toLowerCase().trim()];const value=pair[2].trim();
      if(key==='currency'){
        if(/^(EUR|USD|GBP|KES)$/.test(value))company[key]=value;
        else warnings.push(`Currency '${value}' was not saved because the catalog currently supports EUR, USD, GBP and KES.`);
      }else if(value.length<=({company_name:100,industry:80,description:1000,contact_email:254,phone:60,website:255,timezone:80,business_hours:350} as Record<string,number>)[key]) company[key]=value;
      else warnings.push(`The '${pair[1]}' value is too long; review it manually.`);
      recognized++;continue;
    }
    if(['product catalog','products','services','service catalog'].includes(section)){
      // Example: 1. Essential Hoodie | SKU OT-H001 | Price EUR 70 | Stock 35
      const fields=line.replace(/^\d+[.)]\s*/,'').split('|').map(x=>x.trim());
      const name=fields[0]?.trim();
      const pricePart=fields.find(x=>/\b(?:price\s*)?(EUR|USD|GBP|KES)\s*\d/i.test(x));
      const match=pricePart?.match(/\b(EUR|USD|GBP|KES)\s*([0-9]+(?:[.,][0-9]{1,2})?)\b/i);
      if(name && name.length>=2 && name.length<=120 && match){
        const price=Number(match[2].replace(',','.'));
        if(Number.isFinite(price)&&price>=0&&price<=999999999){
          const sku=fields.find(x=>/^SKU\b/i.test(x));
          const stock=fields.find(x=>/^Stock\b/i.test(x));
          const description=[sku,stock].filter(Boolean).join('; ');
          products.push({name,description,price,currency:match[1].toUpperCase(),is_active:true});
          recognized++;continue;
        }
      }
      warnings.push(`Product line not imported: ${line.slice(0,110)}`);continue;
    }
    if(section==='customers'){
      // Pipe-form or single-line email with space-separated name; no invented fields.
      const first=line.split('|').map(x=>x.trim());
      const email=(line.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)||[])[0];
      let name=first.length>1?first[0]:line.split(email||'\x00')[0].trim();
      name=name.replace(/^[\d.)\s-]+/,'').trim();
      if(email && name.length>=2 && name.length<=120){customers.push({full_name:name,email});recognized++;continue;}
      warnings.push(`Customer line not imported: ${line.slice(0,110)}`);continue;
    }
    if((section==='support hours' || section==='business hours') && !company.business_hours){
      company.business_hours=line;recognized++;continue;
    }
    if(['company policies','policies','quotation policy','faq','faqs'].includes(section)){
      (policySections[section]??=[]).push(line);recognized++;continue;
    }
  }
  for(const [name,content] of Object.entries(policySections))addKnowledge(knowledge,name==='company policies'?'Company Policies':name==='quotation policy'?'Quotation Policy':name==='faqs'?'FAQ':name[0].toUpperCase()+name.slice(1),content);
  const data:Intake={};
  if(Object.keys(company).length)data.company=company;
  if(products.length)data.workspace_services=products;
  if(customers.length)data.customers=customers;
  if(knowledge.length)data.knowledge_entries=knowledge;
  return {data,structured:recognized>=2 && (Object.keys(company).length>0||products.length>0||customers.length>0||knowledge.length>0),warnings};
}
