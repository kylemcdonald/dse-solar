import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('private receipt storage is ignored and absent from the Git index',()=>{
 const tracked=execFileSync('git',['ls-files','-z','--','private/'],{encoding:'utf8'}).split('\0').filter(Boolean);
 assert.equal(tracked.length,0,'Private receipt files must not be tracked or staged in Git.');
 for(const path of ['private/receipts/polowat/ledger.json','private/receipts/polowat/example.pdf','private/receipts/polowat/receipt-records.zip']){
  assert.equal(execFileSync('git',['check-ignore','--no-index',path],{encoding:'utf8'}).trim(),path);
 }
});
