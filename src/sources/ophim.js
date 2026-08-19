import { CONFIG } from '../config.js';
import { createPhimApiSource } from './phimapi.js';

export default createPhimApiSource({ id: 'ophim', label: 'Ophim', api: CONFIG.ophimApi });
