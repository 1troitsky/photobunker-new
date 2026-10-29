// R1-11: read-only RU/EN catalogue audit. No API, account, or browser data.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '../src')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const errors = []
const cautions = []
function source(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function initializer(ast, name) {
  let found
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}
function objectEntries(file, symbol) {
  const ast = source(file, read(file))
  let object = initializer(ast, symbol)
  while (object && (ts.isAsExpression(object) ||
    ts.isSatisfiesExpression(object) || ts.isParenthesizedExpression(object)))
    object = object.expression
  if (!object || !ts.isObjectLiteralExpression(object))
    throw new Error('Missing catalogue '+symbol+' in '+file)
  const entries = new Map()
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(ast)
    if (entries.has(key)) errors.push(file+': duplicate '+key)
    entries.set(key, prop.initializer)
  }
  return entries
}
const ru = objectEntries('i18n.ts', 'ru')
const en = objectEntries('i18n.ts', 'en')
for (const key of ru.keys()) if (!en.has(key)) errors.push('i18n.ts: missing English '+key)
for (const key of en.keys()) if (!ru.has(key)) errors.push('i18n.ts: missing Russian '+key)
const cryptoKeys = objectEntries('crypto/text.ts', 'english')
for (const [key, value] of cryptoKeys)
  if (!ts.isStringLiteralLike(value) || !value.text.trim() || /[А-Яа-яЁё]/.test(value.text))
    errors.push('crypto/text.ts: invalid English translation for '+key)
function walk(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name)
    return entry.isDirectory()?walk(full):/\.(vue|ts)$/.test(full)?[full]:[]
  })
}
let checked=0, qSites=0, pairs=0
for (const file of walk(root)) {
  const name=path.relative(root,file)
  if (name==='crypto/text.ts' || name.endsWith('.d.ts')) continue
  const contents=fs.readFileSync(file,'utf8')
  const q=/\bq\s*\(\s*(?:'([^']+)'|"([^"]+)")\s*\)/g
  for (const match of contents.matchAll(q)) {
    const label=match[1]??match[2]
    qSites++
    if (!cryptoKeys.has(label)) errors.push(name+': untranslated q() source: '+label)
  }
  if (name.endsWith('text.ts') || name.endsWith('-text.ts')) {
    // All simple two-language tuple entries should contain BOTH strings.
    const ast=source(name,contents)
    const visit=node=>{
      if (ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)) {
        const parts=node.initializer.elements
        if (parts.length===2 && parts.every(ts.isStringLiteralLike)) {
          pairs++
          if (parts.some(x=>!x.text.trim())) errors.push(name+': empty RU/EN tuple '+node.name.getText(ast))
        }
      }
      ts.forEachChild(node,visit)
    }
    visit(ast)
  }
  if (name.endsWith('.vue')) {
    // Static template copy is reported for human review, not silently
    // rewritten: product names and user-provided text are intentional.
    const template=contents.split('<template>')[1]??''
    const visible=/<(?:p|h[1-6]|small|strong|button|span|dt|dd)(?:\s[^>]*)?>\s*([^<{\n]+)\s*</g
    for(const item of template.matchAll(visible)){
      const literal=item[1].trim()
      if(literal && /[А-Яа-яЁё]|[A-Za-z]{4}/.test(literal) &&
        !/^(PhotoBunker|NAME-ID|DEMO|GPS|PB1|PB4|Matrix|HTTPS|UUID)$/.test(literal))
        cautions.push(name+': '+literal.slice(0,100))
    }
  }
  checked++
}
console.log('RU/EN catalog audit:',checked,'source modules,',qSites,
  'literal q() calls,',pairs,'translation pairs; template candidates:',cautions.length)
for(const item of cautions)console.log('REVIEW',item)
for(const item of errors)console.error('ERROR',item)
if(errors.length)process.exitCode=1
