import { initUi } from './ui.js';
import { bindCopy } from './copy.js';
import { initMarket } from './market.js';
import { initCa } from './ca.js';

const R = JSON.parse(document.getElementById('register-data').textContent);
bindCopy();
initUi();
initMarket(R.market);
initCa(R);
