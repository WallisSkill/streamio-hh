import { CONFIG } from '../config.js';
import { createPhimApiSource } from './phimapi.js';

export default createPhimApiSource({ id: 'kkphim', label: 'KKPhim', api: CONFIG.kkphimApi });
