import {readFile} from "node:fs/promises"; import Ajv2020 from "ajv/dist/2020.js"; import path from "node:path"; import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
if(!process.argv[2]){console.error("Usage: node scripts/validate-feedback.mjs <path>");process.exit(2)}
try{const data=JSON.parse(await readFile(path.resolve(process.argv[2]),"utf8"));const schema=JSON.parse(await readFile(path.join(root,"feedback/schema.json"),"utf8"));const validate=new Ajv2020({allErrors:false,strict:false}).compile(schema);if(!validate(data)){const e=validate.errors?.[0];console.error(`${e?.instancePath||"/"}: ${e?.message||"invalid"}`);process.exit(1)}console.log("Feedback valid")}catch(e){console.error(e.message);process.exit(1)}
