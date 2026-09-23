import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesCard, rulesVersion } from '../src/verification.js';
import { defaultConfig, validateConfig } from '../src/config.js';
test('verification displays configured rules and acceptance is bound to their version',()=>{
 const card=rulesCard(defaultConfig);
 assert.equal(card.embeds[0].description,defaultConfig.verificationRules);
 assert.equal(card.components[0].components[0].custom_id,'verify-accept:'+rulesVersion(defaultConfig.verificationRules));
 assert.notEqual(rulesVersion('old rules'),rulesVersion('new rules'));
 assert.throws(()=>rulesCard({verificationRules:''}),/not configured/);
 assert.deepEqual(validateConfig({verificationRules:'Custom rules'}),{verificationRules:'Custom rules'});
 for(const verificationRules of ['', 'a'.repeat(1501), 12]) assert.throws(()=>validateConfig({verificationRules}));
});
