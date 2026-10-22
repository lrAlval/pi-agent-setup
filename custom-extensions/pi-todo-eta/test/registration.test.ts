import test from "node:test";
import assert from "node:assert/strict";
import extension from "../src/index.ts";

// Captures registerTool options so we can assert the contract pi's codemode
// and system-prompt builders rely on (promptGuidelines must be string[]).
interface RegisteredTool { name:string; promptGuidelines?:unknown; promptSnippet?:unknown }
const registered:RegisteredTool[] = [];
const handlers:Record<string,unknown> = {};
const fakePi = {
  registerTool:(t:RegisteredTool)=>{registered.push(t);},
  registerCommand:()=>{},
  on:(event:string,handler:unknown)=>{handlers[event]=handler;},
  events:null as unknown,
} as never;

test("registered tools satisfy promptGuidelines: string[] contract", ()=> {
  extension(fakePi);
  const todo = registered.find(t=>t.name==="todo");
  assert.ok(todo, "todo tool must be registered");
  assert.ok(Array.isArray(todo.promptGuidelines),
    `promptGuidelines must be an array, got ${typeof todo.promptGuidelines}; codemode calls guidelines.flatMap on it`);
  for (const g of todo.promptGuidelines as string[]) assert.equal(typeof g, "string");
  assert.equal(typeof todo.promptSnippet, "string");
});
