const { join } = require('node:path')

const ROOT_PATH = join(__dirname, '..')

const consts = {
    // Limits
    // Endpoints
    ACOUSTID_LOOKUP_ENDPOINT: 'https://api.acoustid.org/v2/lookup',
    ACOUSTID_TRACK_ENDPOINT: 'https://acoustid.org/track',
    AUDIOTAG_ENDPOINT: 'https://audiotag.info/api',
    // Folders
    DATABASE_FOLDER: join(ROOT_PATH, 'database'),
    INPUT_FOLDER: join(ROOT_PATH, 'input'),
    LOGS_FOLDER: join(ROOT_PATH, 'logs'),
    PRECOMPUTED_FOLDER: join(ROOT_PATH, 'precomputed'),
    PROCESSED_FOLDER: join(ROOT_PATH, 'processed'),
    TEMP_FOLDER: join(ROOT_PATH, 'temp'),
    TEMP_AUDIO_FOLDER: join(ROOT_PATH, 'temp_audio'),
    // Files
    AFPTS_FILE: join(ROOT_PATH, 'temp', '_afpts.txt'),
    AUDFPRINT_PROGRAM: join(ROOT_PATH, 'libs', 'audfprint', 'audfprint.py'),
    AUDFPRINT_SCRIPT: join(ROOT_PATH, 'scripts', 'audfprint.js'),
    ENV_FILE: join(ROOT_PATH, '.env'),
    EXAMPLE_ENV_FILE: join(ROOT_PATH, '.env.example'),
    FILLER_FILE: join(ROOT_PATH, 'resources', 'filler.mp3'),
    FPCALC_SCRIPT: join(ROOT_PATH, 'scripts', 'fpcalc.js'),
    MUSICBRAINZ_SCRIPT: join(ROOT_PATH, 'scripts', 'musicbrainz.js'),
    PKLZS_FILE: join(ROOT_PATH, 'temp', '_pklzs.txt'),
    RESULTS_FILE: join(ROOT_PATH, 'temp', '_results.json'),
    SHAZAM_SCRIPT: join(ROOT_PATH, 'scripts', 'shazam.py')
}

module.exports = consts

