/* Local font archives, or unmodified TTF/OTF + license from google/fonts.
   No page content is sent to the catalogue. No system fonts are installed. */
const CAPTURE_FONT_BUNDLES={
 'geologica':{family:'Geologica',files:['fonts/Geologica/Geologica-Variable.ttf','fonts/Geologica/OFL.txt'],source:'https://github.com/google/fonts/tree/main/ofl/geologica'},
 'inter tight':{family:'Inter Tight',files:['fonts/InterTight/InterTight-Variable.ttf','fonts/InterTight/OFL.txt'],source:'https://github.com/google/fonts/tree/main/ofl/intertight'},
};
async function fontFetch(url,limit=8*1024*1024){
 const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error(`Не удалось получить шрифт (HTTP ${response.status}).`);error.status=response.status;throw error;}
 if(Number(response.headers.get('content-length'))>limit)throw new Error('Файл шрифта слишком большой.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Файл шрифта слишком большой.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
const fontText=new TextEncoder();
function fontValid(bytes){return bytes.length>12&&((bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0)||String.fromCharCode(...bytes.subarray(0,4))==='OTTO');}
async function fontPackage(family){
 const key=family.toLowerCase(),bundled=CAPTURE_FONT_BUNDLES[key];
 if(bundled){const files=await Promise.all(bundled.files.map(async p=>({name:family+'/'+p.split('/').pop(),bytes:await fontFetch(chrome.runtime.getURL(p))})));files.push({name:family+'/SOURCE.txt',bytes:fontText.encode(bundled.source+'\nНе изменён. Лицензия: OFL.txt.\n')});return files;}
 const slug=family.toLowerCase().replace(/[^a-z0-9]/g,'');
 if(!slug)throw new Error(`Не найден установочный файл «${family}» в открытом каталоге. Нужен файл от автора шрифта.`);
 let meta,folder;
 const raw='https://raw.githubusercontent.com/google/fonts/main/';
 for(const directory of ['ofl','apache','ufl']){
  folder=directory+'/'+slug;
  try{meta=new TextDecoder().decode(await fontFetch(raw+folder+'/METADATA.pb',1024*1024));break;}
  catch(error){if(error.status!==404)throw error;}
 }
 if(!meta)throw new Error(`Не найден установочный файл «${family}» в Google Fonts. Нужен файл от автора шрифта.`);
 const names=[...meta.matchAll(/(?:^|\n)\s*name:\s*"([^"]+)"/g)].map(m=>m[1].toLowerCase());
 if(!names.includes(key))throw new Error(`В каталоге не подтверждено семейство «${family}». Нужен файл от автора шрифта.`);
 const filenames=[...new Set([...meta.matchAll(/(?:^|\n)\s*filename:\s*"([^"]+)"/g)].map(m=>m[1]))];
 if(!filenames.length||filenames.some(n=>!n||/[\\/\x00-\x1f]/.test(n)||!/[.](ttf|otf)$/i.test(n)))throw new Error(`Не удалось подготовить установочный файл «${family}».`);
 if(filenames.length>12)throw new Error(`Для «${family}» найдено слишком много начертаний. Скачайте семейство с Google Fonts.`);
 const licenses={OFL:['OFL.txt'],APACHE2:['LICENSE.txt','LICENSE','Apache License.txt'],UFL:['LICENSE.txt','LICENCE.txt','UFL.txt']};
 const kind=meta.match(/(?:^|\n)license:\s*"([^"]+)"/)?.[1];
 if(!licenses[kind])throw new Error(`В каталоге не подтверждена лицензия «${family}».`);
 let license,licenseBytes;
 for(const name of licenses[kind]){try{licenseBytes=await fontFetch(raw+folder+'/'+encodeURIComponent(name),1024*1024);license=name;break;}catch(error){if(error.status!==404)throw error;}}
 if(!license)throw new Error(`Не найден файл лицензии «${family}».`);
 const files=await Promise.all(filenames.map(async name=>{const bytes=await fontFetch(raw+folder+'/'+encodeURIComponent(name));if(!fontValid(bytes))throw new Error('Получен файл, который не является TTF/OTF.');return {name:family+'/'+name,bytes};}));
 files.push({name:family+'/'+license,bytes:licenseBytes});
 files.push({name:family+'/SOURCE.txt',bytes:fontText.encode('https://github.com/google/fonts/tree/main/'+folder+'\nНе изменён. Лицензия: '+license+'\n')});return files;
}
function fontCRC(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=crc>>>1^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function fontZip(files){
 const local=[],central=[];let offset=0,centralLength=0;
 const header=(length)=>{const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)}};
 for(const file of files){const name=fontText.encode(file.name),crc=fontCRC(file.bytes),size=file.bytes.length;
  const h=header(30+name.length),v=h.view;v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);h.bytes.set(name,30);local.push(h.bytes,file.bytes);
  const c=header(46+name.length),w=c.view;w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,size,true);w.setUint32(24,size,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.bytes.set(name,46);central.push(c.bytes);centralLength+=c.bytes.length;offset+=h.bytes.length+size;
 }
 const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,centralLength,true);end.view.setUint32(16,offset,true);
 const zip=new Uint8Array(offset+centralLength+22);let cursor=0;for(const part of [...local,...central,end.bytes]){zip.set(part,cursor);cursor+=part.length;}return zip;
}
function waitCaptureFontDownload(id){
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);chrome.downloads.onChanged.removeListener(listener);error?reject(error):resolve();};
  const listener=event=>{if(event.id!==id)return;if(event.state?.current==='complete')finish();else if(event.state?.current==='interrupted')finish(new Error('Скачивание архива шрифтов прервано.'));};
  const timer=setTimeout(()=>finish(new Error('Не удалось подтвердить сохранение файла. Проверьте загрузки Chrome.')),20000);
  chrome.downloads.onChanged.addListener(listener);
  chrome.downloads.search({id}).then(items=>{if(items[0]?.state==='complete')finish();else if(items[0]?.state==='interrupted')finish(new Error('Скачивание архива шрифтов прервано.'));},finish);
 });
}
async function downloadCaptureFonts(payload){
 const families=[...new Set((payload?.families||[]).map(f=>String(f).trim()))];
 if(!families.length||families.length>16||families.some(f=>!f||f.length>150||/[\x00-\x1f\\/]/.test(f)||f==='.'||f==='..'))throw new Error('Некорректный список шрифтов.');
 const files=[];for(const family of families){files.push(...await fontPackage(family));if(files.reduce((sum,f)=>sum+f.bytes.length,0)>20*1024*1024)throw new Error('Набор шрифтов слишком большой для одного архива.');}
 const zip=fontZip(files);let binary='';for(let offset=0;offset<zip.length;offset+=8192)binary+=String.fromCharCode(...zip.subarray(offset,offset+8192));
 const label=families.length===1?families[0].replace(/[^\p{L}\p{N} ._-]/gu,'_'):'Fonts';
 const filename=`Clean Capture/Fonts/${label}.zip`;
 const downloadId=await chrome.downloads.download({url:'data:application/zip;base64,'+btoa(binary),filename,conflictAction:'uniquify',saveAs:false});
 await waitCaptureFontDownload(downloadId);
 return {downloadId,filename,families};
}
