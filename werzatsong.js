const dotenv = require('dotenv')
const { exec, spawn } = require('node:child_process')
const { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } = require('node:fs')
const { availableParallelism } = require('node:os')
const { basename, extname, join, resolve, isAbsolute } = require('node:path')
const { promisify } = require('node:util')
const { hideBin } = require('yargs/helpers')
const yargs = require('yargs/yargs')
const { searchWithAudiotag } = require('./scripts/audiotag')
const consts = require('./utils/consts')
const { generateUnique, sleep, trimExtension } = require('./utils/helpers')
const { empty, exit, info, success, possible, warning } = require('./utils/messages')
const { validateAudiotag, validateDuration, validateExtension, validateMusicbrainz } = require('./utils/validators')
const postWebhook = require('./utils/webhook')

// WerZatSong is GUI-driven; it never reads from stdin.
if (process.stdin && !process.stdin.destroyed) process.stdin.destroy()


async function sendWebhook(env, content, filePath = null){
    if(!env.WEBHOOK_URL)
        return false

    try{
        return await postWebhook(env.WEBHOOK_URL, content, filePath)
    }
    catch{
        return false
    }
}

require('node:events').setMaxListeners(100) // increase listeners limit

const AUDFPRINT_LOWEST_HASHES = 25 // amount
const AUDFPRINT_LOWEST_SCORE = 7 // percentage
const AUDFPRINT_HIGHEST_HASHES = 40 // amount
const AUDFPRINT_HIGHEST_SCORE = 2 // percentage
const AUDFPRINT_EXTREME_HASHES = 70 // amount
const MAX_FILES_PER_SEARCH = 100000 // amount
const MUSICBRAINZ_MIN_SCORE = 60 // percentage
const PROGRAM_VERSION = 'v1.0.0'
const RESULTS_FOLDER = join(consts.LOGS_FOLDER, generateUnique())
const SHAZAM_SLEEP = 1.5 // seconds
const WEBHOOK_SLEEP = 2 // seconds

const Mode = {
    AUDFPRINT: 'audfprint',
    AUDIOTAG: 'audiotag',
    MUSICBRAINZ: 'musicbrainz',
    SHAZAM: 'shazam'
}

const execPromise = promisify(exec)
const { argv } = yargs(hideBin(process.argv))
// Program version
.version(PROGRAM_VERSION)
// Search modes
.option(Mode.AUDFPRINT, { type: 'boolean', description: 'Enable Audfprint-based matching' })
.option(Mode.AUDIOTAG, { type: 'boolean', description: 'Enable search using the Audiotag API' })
.option(Mode.MUSICBRAINZ, { type: 'boolean', description: 'Enable search using MusicBrainz (AcoustID API)' })
.option(Mode.SHAZAM, { type: 'boolean', description: 'Enable search using Shazam API' })
// Global options
.option('trim', { type: 'number', description: 'Trim MP3 files to the specified length (in seconds) before processing' })
// MusicBrainz options
.option('duration', { type: 'string', description: 'Set the allowed duration range for MusicBrainz searches (format: "min:max")' })
.option('extension', { type: 'number', description: 'Extend MP3 files by the specified number of seconds before MusicBrainz analysis' })
// Audfprint options
.option('database', { type: 'array', description: 'Database folders or PKLZ files to use' })
.option('threads', { type: 'number', description: 'Set the number of threads to use for Audfprint processing' })
.option('speed', {
    type: 'number',
    description: 'Speed correction percentage'
})

.option('multi-speed', {
    type: 'string',
    description: 'Multiple speed correction values'
})

.option('trim-first', {
    type: 'boolean',
    description: 'Trim input files to first 75 seconds'
})

.option('trim-middle', {
    type: 'boolean',
    description: 'Trim input files to middle 45 seconds'
})

.option('fingerprint', { type: 'boolean' })
.option('source', { type: 'array' })
.option('dbname', { type: 'string' })
.option('split', { type: 'boolean' })
.option('files-per-database', { type: 'number' })

function setupFolders(){
    const foldersToClean = [
        consts.PRECOMPUTED_FOLDER,
        consts.PROCESSED_FOLDER,
        consts.TEMP_FOLDER,
        consts.TEMP_AUDIO_FOLDER
    ]
    for(const folder of foldersToClean){
        if(existsSync(folder))
            rmSync(folder, { recursive: true })
        mkdirSync(folder)
    }
    const foldersToCreate = [
        ...foldersToClean,
        consts.DATABASE_FOLDER,
        consts.INPUT_FOLDER,
        consts.LOGS_FOLDER
    ]
    for(const folder of foldersToCreate){
        if(!existsSync(folder))
            mkdirSync(folder)
    }
}

function fetchEnvironment(){
    if(!existsSync(consts.ENV_FILE))
        copyFileSync(consts.EXAMPLE_ENV_FILE, consts.ENV_FILE)

    const { parsed } = dotenv.config()
    const env = parsed || {}

    // Resolve portable runtime paths relative to werzatsong.js itself.
    // This is required for spawn(), which does not reliably resolve
    // relative executable paths when the GUI launches Node from another cwd.
    for(const key of ['FFMPEG_COMMAND', 'NODE_COMMAND', 'PYTHON_COMMAND']){
        const value = env[key]
        if(value && !isAbsolute(value) && (value.includes('/') || value.includes('\\'))){
            env[key] = resolve(__dirname, value)
        }
    }

    return env
}

function parseModes(){
    const modes = []
    if(argv.audfprint)
        modes.push(Mode.AUDFPRINT)
    if(argv.audiotag)
        modes.push(Mode.AUDIOTAG)
    if(argv.musicbrainz)
        modes.push(Mode.MUSICBRAINZ)
    if(argv.shazam)
        modes.push(Mode.SHAZAM)
    if(modes.length === 0)
        exit(`Please choose at least one search mode (${Object.values(Mode).map(value => `--${value}`).join(', ')})`)
    return modes
}

function loadSamples(modes){
    const audioExtensions = new Set([
        '.mp3',
        '.flac',
        '.wav',
        '.m4a',
        '.ogg',
        '.opus',
        '.ape',
        '.aiff',
        '.alac',
        '.wma'
    ])

    const audioFiles = readdirSync(consts.INPUT_FOLDER)
        .filter(filename => audioExtensions.has(extname(filename).toLowerCase()))

    const precomputedFiles = readdirSync(consts.INPUT_FOLDER)
        .filter(filename => filename.endsWith('.afpt'))

    if(modes.some(mode => mode !== Mode.AUDFPRINT) && audioFiles.length === 0)
        exit(`You need at least one supported audio file in the "input" folder if you included mode: ${Mode.AUDIOTAG}, ${Mode.MUSICBRAINZ} or ${Mode.SHAZAM}`)

    if(audioFiles.length > MAX_FILES_PER_SEARCH)
        exit(`Too many audio files! Limit per each search is ${MAX_FILES_PER_SEARCH} files, but found ${audioFiles.length} supported audio files`)

    if(modes.includes(Mode.AUDFPRINT) && audioFiles.length === 0 && precomputedFiles.length === 0)
        exit(`In ${Mode.AUDFPRINT} mode, add at least one supported audio file or AFPT file to "input" folder`)

    const audioBasenames = audioFiles.map(file => trimExtension(file))
    const afptBasenames = precomputedFiles.map(file => trimExtension(file))

    const collisions = audioBasenames.filter(base => afptBasenames.includes(base))

    if(collisions.length > 0){
        const collisionFiles = collisions.map(base => `- ${base} / ${base}.afpt\n`).join('')
        exit(`Duplicated filename collisions detected in "input" folder:\n${collisionFiles}`)
    }

    const totalFiles = audioFiles.length + precomputedFiles.length

    if(modes.includes(Mode.AUDFPRINT) && totalFiles > MAX_FILES_PER_SEARCH)
        exit(`Too many files! Limit per each ${Mode.AUDFPRINT} search is ${MAX_FILES_PER_SEARCH} files, but found ${totalFiles} files (audio + AFPT)`)

    return { audioFiles, precomputedFiles }
}


async function trimFile(ffmpegCommand, filename, seconds){
    try {
        const originalPath = join(consts.INPUT_FOLDER, filename)
        const trimmedPath = join(consts.PROCESSED_FOLDER, filename)
        await execPromise(`${ffmpegCommand} -i "${originalPath}" -y -t ${seconds} "${trimmedPath}"`)
    }
    catch(error){
        exit(`Failed to trim "${filename}": ${error.message}`)
    }
}



async function getAudioDuration(ffmpegCommand, input){

    const ffprobe = ffmpegCommand.replace(
        /ffmpeg(\.exe)?$/i,
        "ffprobe$1"
    )

    const { stdout } = await execPromise(
        `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${input}"`
    )

    return parseFloat(stdout)

}

async function resolveTrimInput(ffmpegCommand, input){
    try{
        await getAudioDuration(ffmpegCommand, input)
        return input
    }
    catch(error){
        const details = error.stderr || error.stdout || error.message || ''

        warning(`Trim audio read failed: "${basename(input)}"`)
        info(`Trim Audio Recovery: repairing "${basename(input)}"`)

        const recoveredFile = await recoverAudioFile(
            ffmpegCommand,
            input
        )

        if(!recoveredFile)
            throw new Error(
                `Unable to recover audio for trim: ${basename(input)}. ${details}`
            )

        success(`Trim Audio Recovery verified: "${basename(input)}"`)

        // Verify the recovered file itself before trimming.
        await getAudioDuration(ffmpegCommand, recoveredFile)
        return recoveredFile
    }
}

async function trimFirstFile(ffmpegCommand, filename){
    try{
        const originalPath = join(consts.INPUT_FOLDER, filename)
        const input = await resolveTrimInput(ffmpegCommand, originalPath)
        const outputExtension = extname(input) || extname(filename)

        const output = join(
            consts.TEMP_AUDIO_FOLDER,
            `${trimExtension(filename)}_trim_first${outputExtension}`
        )

        const duration = await getAudioDuration(ffmpegCommand, input)

        if(isNaN(duration) || duration <= 75){
            copyFileSync(input, output)
            return output
        }

        info(`Creating first 75-second trim: ${filename}`)

        await execPromise(
            `"${ffmpegCommand}" -y -i "${input}" -t 75 "${output}"`
        )

        return output
    }
    catch(error){
        exit(
            `Failed to trim first 75 seconds of "${filename}": ${
                error.stderr || error.stdout || error.message
            }`
        )
    }
}

async function trimMiddleFile(ffmpegCommand, filename){
    try{
        const originalPath = join(consts.INPUT_FOLDER, filename)
        const input = await resolveTrimInput(ffmpegCommand, originalPath)
        const outputExtension = extname(input) || extname(filename)

        const output = join(
            consts.TEMP_AUDIO_FOLDER,
            `${trimExtension(filename)}_trim_middle${outputExtension}`
        )

        const duration = await getAudioDuration(ffmpegCommand, input)

        if(isNaN(duration) || duration <= 45){
            copyFileSync(input, output)
            return output
        }

        const start = (duration - 45) / 2

        info(`Creating middle trim: ${filename}`)

        await execPromise(
            `"${ffmpegCommand}" -y -ss ${start} -i "${input}" -t 45 "${output}"`
        )

        return output
    }
    catch(error){
        exit(
            `Failed to trim middle of "${filename}": ${
                error.stderr || error.stdout || error.message
            }`
        )
    }
}


async function speedFile(ffmpegCommand, inputFile, speed){

    try{

        const output = join(
            consts.TEMP_AUDIO_FOLDER,
            `${trimExtension(basename(inputFile))}_sp${speed >= 0 ? "+" : ""}${speed}${extname(inputFile)}`
        )

        info(`Creating speed corrected file (${speed >= 0 ? "+" : ""}${speed}%)`)

        const factor = (1 + (Number(speed) / 100)).toFixed(4)

await execPromise(
    `"${ffmpegCommand}" -y -i "${inputFile}" -af "rubberband=tempo=${factor}:pitch=${factor}" "${output}"`
)

        return output

    }
    catch(error){

        exit(`Failed to create speed corrected file: ${error.message}`)

    }

}


function repairBrokenWavContainer(inputFile){
    // Some WAV files are perfectly playable but contain a malformed LIST chunk.
    // Audfprint/scipy is stricter than media players and rejects these files.
    // Rebuild a minimal RIFF/WAVE containing the original fmt + data chunks.
    try{
        const input = readFileSync(inputFile)
        if(input.length < 12 || input.toString('ascii', 0, 4) !== 'RIFF' || input.toString('ascii', 8, 12) !== 'WAVE')
            return null

        const fmtPos = input.indexOf(Buffer.from('fmt '), 12)
        if(fmtPos < 0 || fmtPos + 8 > input.length)
            return null

        const fmtSize = input.readUInt32LE(fmtPos + 4)
        const fmtEnd = fmtPos + 8 + fmtSize
        if(fmtSize < 16 || fmtEnd > input.length)
            return null

        // Search for the real data chunk instead of trusting malformed LIST sizes.
        let dataPos = input.indexOf(Buffer.from('data'), fmtEnd)
        if(dataPos < 0 || dataPos + 8 > input.length)
            return null

        const declaredDataSize = input.readUInt32LE(dataPos + 4)
        const availableDataSize = input.length - (dataPos + 8)
        const dataSize = Math.min(declaredDataSize, availableDataSize)
        if(dataSize <= 0)
            return null

        const fmtChunk = input.subarray(fmtPos, fmtEnd)
        const audioData = input.subarray(dataPos + 8, dataPos + 8 + dataSize)
        const dataChunkSize = audioData.length

        const riffSize = 4 + fmtChunk.length + 8 + dataChunkSize
        const output = Buffer.alloc(12 + fmtChunk.length + 8 + dataChunkSize)

        output.write('RIFF', 0, 4, 'ascii')
        output.writeUInt32LE(riffSize, 4)
        output.write('WAVE', 8, 4, 'ascii')
        fmtChunk.copy(output, 12)
        let offset = 12 + fmtChunk.length
        output.write('data', offset, 4, 'ascii')
        output.writeUInt32LE(dataChunkSize, offset + 4)
        audioData.copy(output, offset + 8)

        return output
    }
    catch{
        return null
    }
}

function stripMp3MetadataContainers(inputFile){
    try{
        let data = readFileSync(inputFile)

        // Remove one or more leading ID3v2 tags.
        while(data.length >= 10 && data.toString('ascii', 0, 3) === 'ID3'){
            const flags = data[5]
            const size =
                ((data[6] & 0x7f) << 21) |
                ((data[7] & 0x7f) << 14) |
                ((data[8] & 0x7f) << 7) |
                (data[9] & 0x7f)

            let total = 10 + size
            if(flags & 0x10) total += 10 // ID3v2 footer

            if(total <= 10 || total > data.length) break
            data = data.subarray(total)
        }

        // Remove trailing ID3v1.
        if(data.length >= 128 && data.toString('ascii', data.length - 128, data.length - 125) === 'TAG')
            data = data.subarray(0, data.length - 128)

        // Remove trailing APEv2 tag(s).
        while(data.length >= 32){
            const pos = data.length - 32
            if(data.toString('ascii', pos, pos + 8) !== 'APETAGEX') break

            const tagSize = data.readUInt32LE(pos + 12)
            if(tagSize < 32 || tagSize > data.length) break

            data = data.subarray(0, data.length - tagSize)
        }

        // Remove Lyrics3 v2 if present at the end.
        const lyricsMarker = Buffer.from('LYRICS200', 'ascii')
        const markerPos = data.lastIndexOf(lyricsMarker)
        if(markerPos >= 15){
            const sizeText = data.toString('ascii', markerPos - 6, markerPos)
            if(/^\d{6}$/.test(sizeText)){
                const bodySize = Number(sizeText)
                const start = markerPos - 6 - bodySize
                if(start >= 0)
                    data = data.subarray(0, start)
            }
        }

        // APEv2 can also be identified by a header after stripping the footer.
        const apeHeader = data.lastIndexOf(Buffer.from('APETAGEX', 'ascii'))
        if(apeHeader >= 0 && apeHeader > Math.max(0, data.length - 1024 * 1024)){
            if(apeHeader > 0)
                data = data.subarray(0, apeHeader)
        }

        return data
    }
    catch{
        return null
    }
}

async function recoverAudioFile(ffmpegCommand, inputFile, destinationFile = null){
    const inputExt = extname(inputFile).toLowerCase()
    const baseName = trimExtension(basename(inputFile))

    // Creator can provide the final ADD location directly. This avoids the
    // old two-copy path: TEMP recovery file -> creator_recovery copy.
    const outputFile = destinationFile || join(
        consts.TEMP_AUDIO_FOLDER,
        `${baseName}_recovered${inputExt || '.wav'}`
    )


    info(`Audio recovery: cleaning "${basename(inputFile)}" (all metadata + cover removed)`)

    try{
        if(existsSync(outputFile))
            rmSync(outputFile, { force: true })

        // First attempt: keep the ORIGINAL container/format.
        // We only copy the audio stream and remove metadata, artwork,
        // chapters and non-audio streams. This avoids MP3 -> huge WAV
        // expansion and avoids unnecessary re-encoding.
        try{
            await execPromise(
                `"${ffmpegCommand}" -y -hide_banner -loglevel error -i "${inputFile}" -map 0:a:0 -map_metadata -1 -map_chapters -1 -vn -sn -dn -c:a copy "${outputFile}"`
            )

            if(existsSync(outputFile)){
                success(`Audio recovery successful (original format preserved): "${basename(inputFile)}"`)
                return outputFile
            }
        }
        catch{}

        // MP3 fallback: remove raw ID3v2/ID3v1/APEv2/Lyrics3 containers
        // without decoding/re-encoding the audio. The cleaned MP3 is kept
        // as MP3, so its size stays close to the original.
        if(inputExt === '.mp3'){
            info(`MP3 metadata container cleanup: removing hidden tags from "${basename(inputFile)}"`)
            const cleaned = stripMp3MetadataContainers(inputFile)

            if(cleaned && cleaned.length > 0){
                try{
                    // Write the cleaned MP3 directly to the final recovery
                    // folder. No intermediate MP3 copy is created.
                    writeFileSync(outputFile, cleaned)
                    // The stripped file is already a valid MP3 bitstream;
                    // use it directly rather than creating a PCM WAV copy.
                    await execPromise(
                        `"${ffmpegCommand}" -v error -i "${outputFile}" -map 0:a:0 -f null -`
                    )

                    success(`Audio recovery successful after MP3 metadata cleanup: "${basename(inputFile)}"`)
                    return outputFile
                }
                catch{}
            }
        }

        // WAV fallback: repair the malformed RIFF structure and keep the
        // repaired result as WAV. No second PCM conversion is necessary.
        if(inputExt === '.wav'){
            info(`WAV container repair: removing malformed RIFF chunks from "${basename(inputFile)}"`)
            const repaired = repairBrokenWavContainer(inputFile)

            if(repaired){
                try{
                    // repairBrokenWavContainer() already returns a valid WAV.
                    // Write it directly to the final recovery folder.
                    writeFileSync(outputFile, repaired)

                    await execPromise(
                        `"${ffmpegCommand}" -v error -i "${outputFile}" -map 0:a:0 -f null -`
                    )

                    success(`Audio recovery successful after WAV container repair: "${basename(inputFile)}"`)
                    return outputFile
                }
                catch{}
            }
        }

        throw new Error('Same-format FFmpeg recovery and container repair both failed')
    }
    catch(error){
        // Do not leave a partial recovered file behind after a failed attempt.
        if(existsSync(outputFile))
            rmSync(outputFile, { force: true })

        warning(`Audio recovery failed for "${basename(inputFile)}": ${error.stderr || error.stdout || error.message}`)
        return null
    }
    finally{
        // No intermediate full-size audio files are created. The recovered
        // file is written directly to outputFile and remains there until the
        // single batch ADD/global TEMP cleanup is finished.
    }
}

function isAudioProcessingError(text){
    const value = String(text || '').toLowerCase()
    return /command failed:|wavfile2peaks|audio_read|error reading header|error reading|decode|decoder|codec|audioread|soundfile|wave|invalid data|error while decoding|could not read|cannot read|failed to read|unsupported audio|corrupt|malformed/.test(value)
}

async function precomputeFile(pythonCommand, inputFile, ffmpegCommand){

    // IMPORTANT: do not run a separate FFmpeg validation pass for every Search
    // file. Audfprint's precompute is already the real audio processing step.
    // Recovery is triggered only if that processing actually fails.
    const runPrecompute = async file => {
        await execPromise(
            `"${pythonCommand}" "${consts.AUDFPRINT_PROGRAM}" precompute --precompdir "${consts.PRECOMPUTED_FOLDER}" --shifts 4 "${file}"`
        )

        return `${trimExtension(basename(file))}.afpt`
    }

    try{
        // Normal path: one Audfprint pass, with zero extra FFmpeg pre-check.
        return await runPrecompute(inputFile)
    }
    catch(error){

        const details = error.stderr || error.stdout || error.message || ''

        // Only audio/decode failures trigger recovery. Other program errors
        // are reported normally and are not masked by the recovery system.
        if(!isAudioProcessingError(details)){
            exit(`Failed to precompute "${basename(inputFile)}": ${details}`)
        }

        warning(`Search audio processing failed: "${basename(inputFile)}"`)
        info(`Search Audio Recovery: repairing "${basename(inputFile)}"`)

        const recoveredFile = await recoverAudioFile(
            ffmpegCommand,
            inputFile
        )

        if(!recoveredFile){
            exit(`Failed to recover "${basename(inputFile)}". Original audio was not changed.`)
        }

        try{
            // Replace only the processed copy, never the user's original input.
            copyFileSync(recoveredFile, inputFile)

            success(`Search Audio Recovery verified: "${basename(inputFile)}"`)

            // Retry only this failed file. Normal files never pay the recovery
            // or validation overhead.
            return await runPrecompute(inputFile)
        }
        catch(retryError){
            exit(
                `Recovered audio still failed for "${basename(inputFile)}": ${
                    retryError.stderr || retryError.stdout || retryError.message
                }`
            )
        }
    }
}

async function generateFiles(env, trimSeconds, speed, multiSpeed, trimFirst, trimMiddle, modes, audioFiles, precomputedFiles){
    const filesToProcess = { afpts: [], mp3s: [] }
    const useTrimFirst = trimFirst === true
    const useTrimMiddle = trimMiddle === true
const speedValues = []

if (multiSpeed && multiSpeed.length > 0) {

    speedValues.push(
        ...multiSpeed
            .split(",")
            .map(v => Number(v.trim()))
            .filter(v => !isNaN(v))
    )

}
else if (!isNaN(Number(speed))) {

    speedValues.push(Number(speed))

}
else {

    speedValues.push(0)

}
info(`DEBUG speed = ${speed}`)
info(`DEBUG multiSpeed = ${multiSpeed}`)
info(`DEBUG speedValues = ${JSON.stringify(speedValues)}`) 
   if(audioFiles?.length > 0){
        for(const audioFile of audioFiles){

            const inputPath = join(consts.INPUT_FOLDER, audioFile)
            const trimSources = []

            if(useTrimFirst)
                trimSources.push(
                    await trimFirstFile(
                        env.FFMPEG_COMMAND,
                        audioFile
                    )
                )

            if(trimMiddle)
                trimSources.push(
                    await trimMiddleFile(
                        env.FFMPEG_COMMAND,
                        audioFile
                    )
                )

            if(trimSources.length === 0){

                let currentFile = join(
                    consts.PROCESSED_FOLDER,
                    audioFile
                )

                if(isNaN(Number(trimSeconds)) || trimSeconds <= 0){

                    copyFileSync(
                        inputPath,
                        currentFile
                    )

                }
                else{

                    await trimFile(
                        env.FFMPEG_COMMAND,
                        audioFile,
                        trimSeconds
                    )

                }

                trimSources.push(currentFile)

            }

            for(const currentFile of trimSources){

                for(const currentSpeed of speedValues){

                    let processedFile = currentFile

                    if(currentSpeed !== 0){

                        info(
                            `Speed correction: ${currentSpeed > 0 ? '+' : ''}${currentSpeed}%`
                        )

                        processedFile = await speedFile(
                            env.FFMPEG_COMMAND,
                            processedFile,
                            currentSpeed
                        )

                    }

                    filesToProcess.mp3s.push(processedFile)

                    if(modes.includes(Mode.AUDFPRINT)){

                        const precomputedFile = await precomputeFile(
                            env.PYTHON_COMMAND,
                            processedFile,
                            env.FFMPEG_COMMAND
                        )

                        if(precomputedFile){

                            filesToProcess.afpts.push(
                                join(
                                    consts.PRECOMPUTED_FOLDER,
                                    precomputedFile
                                )
                            )

                        }

                    }

                }

            }

        }
    }
    if(modes.includes(Mode.AUDFPRINT) && precomputedFiles?.length > 0){
        for(const precomputedFile of precomputedFiles){
            copyFileSync(join(consts.INPUT_FOLDER, precomputedFile), join(consts.PRECOMPUTED_FOLDER, precomputedFile))
            filesToProcess.afpts.push(join(consts.PRECOMPUTED_FOLDER, precomputedFile))
        }
    }
    return filesToProcess
}

function createResultsLog(basename, mode, content){
    if(!existsSync(RESULTS_FOLDER))
        mkdirSync(RESULTS_FOLDER)
    const resultsFile = join(RESULTS_FOLDER, `${basename}.${mode}.txt`)
    writeFileSync(resultsFile, content, 'utf8')
    return resultsFile
}

function fetchFingerprints(targetFolder){
    let pklzFiles = []
    const fetchFilesRecursively = dir => {
        const files = readdirSync(dir, { withFileTypes: true })
        for(const file of files){
            const fullPath = join(dir, file.name)
            if(file.isDirectory())
                fetchFilesRecursively(fullPath)
            else if(file.isFile() && file.name.endsWith('.pklz'))
                pklzFiles.push(fullPath)
        }
    }
    fetchFilesRecursively(targetFolder)
    return pklzFiles
}

function setupAudfprint(databases){

    let pklzFiles = []

    // All databases (default)
    if(!databases || databases.length === 0){

        pklzFiles = fetchFingerprints(consts.DATABASE_FOLDER)

    }else{

        for(const item of databases){

    const databaseName = String(item)

    const target = join(
        consts.DATABASE_FOLDER,
        databaseName
    )


            if(!existsSync(target))
                exit(`"${databaseName}" does not exist inside database/`)

            if(extname(target).toLowerCase() === '.pklz'){

                pklzFiles.push(target)

            }else{

                pklzFiles.push(...fetchFingerprints(target))

            }

        }

    }

    pklzFiles = [...new Set(pklzFiles)]

    if(pklzFiles.length === 0)
        exit('No PKLZ files found.')

    writeFileSync(
        consts.PKLZS_FILE,
        pklzFiles.join('\n')
    )

}

function audfprint(env, threads){
    return new Promise((resolve, reject) => {

        info(`Using ${threads} concurrent threads for processing`)
        info(`Configured worker count: ${threads}`)

        const audfprintProcess = spawn(
            env.NODE_COMMAND,
            [consts.AUDFPRINT_SCRIPT, '--threads', threads],
            {
                stdio: ['ignore', 'pipe', 'pipe']
            }
        )

        let workerMonitor = null
        let maxDetectedWorkers = 0

        // On Windows, count Python worker processes whose parent chain
        // descends from the Audfprint Node process. This is diagnostic only.
        if (process.platform === 'win32') {
            workerMonitor = setInterval(() => {
                const ps = spawn('powershell.exe', [
                    '-NoProfile',
                    '-Command',
                    `$root=${audfprintProcess.pid}; $ids=@($root); $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name; $changed=$true; while($changed){$changed=$false; foreach($p in $all){if($ids -contains [int]$p.ParentProcessId -and -not ($ids -contains [int]$p.ProcessId)){ $ids += [int]$p.ProcessId; $changed=$true }}}; ($all | Where-Object {$ids -contains [int]$_.ProcessId -and $_.Name -match "python|node"} | Measure-Object).Count`
                ], { stdio: ['ignore', 'pipe', 'ignore'] })

                let out = ''
                ps.stdout.on('data', d => out += d.toString())
                ps.on('close', () => {
                    const count = Math.max(0, Number.parseInt(out.trim(), 10) || 0)
                    if(count > maxDetectedWorkers) maxDetectedWorkers = count
                })
            }, 1000)
        }

        audfprintProcess.stdout.on('data', data => {
            info(data.toString().trim())
        })
        audfprintProcess.stderr.on('data', data => {
            const errorMessage = data.toString().trim()
            exit(errorMessage.includes('MemoryError') ? 'The process ran out of memory. Please try reducing the number of threads and run it again' : errorMessage)
        })
        audfprintProcess.on('close', code => {

            if(workerMonitor)
                clearInterval(workerMonitor)

            if(maxDetectedWorkers > 0)
                info(`Maximum detected worker processes: ${maxDetectedWorkers}`)
            else
                info(`Maximum detected worker processes: unavailable (process exited too quickly)`)

            if(code === 0)
                resolve()
            else {
                warning(`Mode ${Mode.AUDFPRINT} exited with error code: ${code}`)
                reject()
            }
        })
    })
}

async function createAudfprintLogs(env){
    const results = JSON.parse(readFileSync(consts.RESULTS_FILE, 'utf-8'))
    const matchesByAfpt = {}
    for(const [, match] of Object.entries(results)){
        const inputBasename = trimExtension(basename(match.input_file))
        if(!matchesByAfpt[inputBasename])
            matchesByAfpt[inputBasename] = []
        matchesByAfpt[inputBasename].push({
            matched_file: match.matched_file,
            matched_file_basename: basename(match.matched_file),
            match_score: ((match.common_hashes / match.total_hashes) * 100).toFixed(2),
            common_hashes: match.common_hashes,
            total_hashes: match.total_hashes,
            match_time: match.match_time,
            rank_position: match.rank_position,
            counter: match.counter
        })
    }
    for(const [inputBasename, matches] of Object.entries(matchesByAfpt)){
        matches.sort((a, b) => b.common_hashes - a.common_hashes)
        let logContent = ''
        let hasSuccess = false
        let hasPossible = false

        let bestSuccessSpeed = ""
        let bestPossibleSpeed = ""

        let bestSuccessHashes = -1
        let bestPossibleHashes = -1
for(const match of matches){

    let displayName = match.matched_file_basename
    let speedInfo = "Original speed"
    let trimInfo = "Full File"

    if(inputBasename.includes("_trim_first"))
        trimInfo = "First 75 Seconds"
    else if(inputBasename.includes("_trim_middle"))
        trimInfo = "Middle 45 Seconds"

    const speedMatch = inputBasename.match(/_sp([+-]?\d+(\.\d+)?)/)

    if(speedMatch){

        speedInfo = `Speed ${speedMatch[1]}`

    }

    displayName = displayName
        .replace(/_trim_first/g, "")
        .replace(/_trim_middle/g, "")
        .replace(/_trim/g, "")

    let status = ""

    if(match.common_hashes >= AUDFPRINT_EXTREME_HASHES){

        status = "🟢 SUCCESS "

    }
    else if(match.common_hashes >= AUDFPRINT_HIGHEST_HASHES){

        status = "🟠 POSSIBLE "

    }
    else if(match.common_hashes >= AUDFPRINT_LOWEST_HASHES){

        status = "🟡 WEAK "

    }
    else if(
        match.common_hashes >= 18
    ){

        status = "⚪ LOW (may still be correct) "

    }



    let consoleSpeed = "Original speed"

const sm = inputBasename.match(/_sp([+-]?\d+(\.\d+)?)/)

if(sm)
    consoleSpeed = `Speed ${sm[1]}`

if(status.startsWith("🟢 SUCCESS")){

    hasSuccess = true

    if(match.common_hashes > bestSuccessHashes){

        bestSuccessHashes = match.common_hashes
        bestSuccessSpeed = `${consoleSpeed} | ${trimInfo}`

    }

}
else if(status.startsWith("🟠 POSSIBLE")){

    hasPossible = true

    if(match.common_hashes > bestPossibleHashes){

        bestPossibleHashes = match.common_hashes
        bestPossibleSpeed = `${consoleSpeed} | ${trimInfo}`

    }

}

    logContent +=
`${status}[${match.common_hashes}/${match.total_hashes} | ${match.match_score}% | x${match.counter} | ${match.rank_position} | ${match.match_time}] [${speedInfo}] [${trimInfo}] ${displayName} (${match.matched_file})

`

}

if(hasSuccess || hasPossible){

    const displayInput = inputBasename
    .replace(/_sp[+-]?\d+(\.\d+)?/, "")
    .replace(/_trim_first/g, "")
    .replace(/_trim_middle/g, "")
    .replace(/_trim/g, "")

info(`🎵 ${displayInput}`)

    if(hasSuccess)
        success(`🟢 SUCCESS [${bestSuccessSpeed}]`)

    if(hasPossible)
        possible(`🟠 POSSIBLE [${bestPossibleSpeed}]`)

}

createResultsLog(
    inputBasename,
    Mode.AUDFPRINT,
    logContent
)
        const possibleMatches = matches.filter(match =>
    (match.match_score >= AUDFPRINT_LOWEST_SCORE && match.common_hashes >= AUDFPRINT_LOWEST_HASHES) ||
    (match.match_score >= AUDFPRINT_HIGHEST_SCORE && match.common_hashes >= AUDFPRINT_HIGHEST_HASHES) ||
    (match.common_hashes >= AUDFPRINT_EXTREME_HASHES)
)

if(possibleMatches.length > 0 && env.WEBHOOK_URL){

const tempFile = join(consts.TEMP_FOLDER, `${inputBasename}.webhook.txt`)
let webhookContent = ''

for(const match of possibleMatches)
    webhookContent += `[${match.common_hashes}/${match.total_hashes} | ${match.match_score}% | x${match.counter} | ${match.rank_position} | ${match.match_time}]: ${match.matched_file_basename}\n\n`

writeFileSync(tempFile, webhookContent, 'utf-8')

const basenameWithFormat = `${inputBasename}.mp3`

await sleep(WEBHOOK_SLEEP)

await sendWebhook(
    env,
    `[${Mode.AUDFPRINT}]: ${basenameWithFormat}`,
    tempFile
)

unlinkSync(tempFile)

// console output moved to TXT status loop

}
    }
}

async function musicbrainz(env, file, extension, duration){
    const fileBasename = basename(file)
    try {
        await execPromise(`${env.NODE_COMMAND} "${consts.FPCALC_SCRIPT}" --file "${file}" --extension ${extension}`)
        const { stdout } = await execPromise(`${env.NODE_COMMAND} "${consts.MUSICBRAINZ_SCRIPT}" --file "${basename(file)}" --duration "${duration}"`)
        const outputLogs = stdout.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
        let results = []
        for(const outputLog of outputLogs){
            if(outputLog.error)
                exit(`Detected an invalid AcoustID API key: ${outputLog.data}`)
            results = outputLog.data.filter(result => parseFloat(result.score) >= MUSICBRAINZ_MIN_SCORE).map(result => {
                return `[${result.score}% | EXT-${result.extension} | DUR-${result.duration}]: ${consts.ACOUSTID_TRACK_ENDPOINT}/${result.trackId}`
            })
        }
        if(results.length > 0){
            const resultsFile = createResultsLog(trimExtension(fileBasename), Mode.MUSICBRAINZ, `${results.join('\n')}\n`)
            const webhookSent = await sendWebhook(env, `[${Mode.MUSICBRAINZ}]: ${fileBasename}`, resultsFile)
            success(
                webhookSent
                    ? `Possible match found during search against "${fileBasename}" with ${Mode.MUSICBRAINZ} mode. Discord webhook message has been sent`
                    : `Possible match found during search against "${fileBasename}" with ${Mode.MUSICBRAINZ} mode`
            )
        }
        else
            empty(`No match found during search against "${fileBasename}" with ${Mode.MUSICBRAINZ} mode`)
    }
    catch(error){
        warning(`Failed to run ${Mode.MUSICBRAINZ} search against "${fileBasename}": ${error.message}`)
    }
}

async function audiotag(env, file){
    const fileBasename = basename(file)
    const response = await searchWithAudiotag(env.AUDIOTAG_KEY, file)
    if(response.match){
        const resultsFile = createResultsLog(trimExtension(fileBasename), Mode.AUDIOTAG, `${JSON.stringify(response.match)}\n`)
        const webhookSent = await sendWebhook(env, `[${Mode.AUDIOTAG}]: ${fileBasename}`, resultsFile)
        success(
            webhookSent
                ? `Possible match found during search against "${fileBasename}" with ${Mode.AUDIOTAG} mode. Discord webhook message has been sent`
                : `Possible match found during search against "${fileBasename}" with ${Mode.AUDIOTAG} mode`
        )
    }
    else if(response.error)
        warning(`Failed to run ${Mode.AUDIOTAG} search against "${fileBasename}": ${response.error}`)
    else
        empty(`No match found during search against "${fileBasename}" with ${Mode.AUDIOTAG} mode`)
}

async function shazam(env, file){
    const fileBasename = basename(file)
    try {
        await sleep(SHAZAM_SLEEP)
        const { stdout } = await execPromise(`"${env.PYTHON_COMMAND}" "${consts.SHAZAM_SCRIPT}" "${file}"`)
        const result = stdout.trim()
        if(result !== ''){
            const resultsFile = createResultsLog(trimExtension(fileBasename), Mode.SHAZAM, `${result}\n`)
            const webhookSent = await sendWebhook(env, `[${Mode.SHAZAM}]: ${fileBasename}`, resultsFile)
            success(
                webhookSent
                    ? `Possible match found during search against "${fileBasename}" with ${Mode.SHAZAM} mode. Discord webhook message has been sent`
                    : `Possible match found during search against "${fileBasename}" with ${Mode.SHAZAM} mode`
            )
        }
        else
            empty(`No match found during search against "${fileBasename}" with ${Mode.SHAZAM} mode`)
    }
    catch(error){
        warning(`Failed to run ${Mode.SHAZAM} search against "${fileBasename}": ${error.message}`)
    }
}




function findAudioFiles(sources){
    const fs = require('node:fs')
    const path = require('node:path')
    const exts = new Set(['.mp3','.flac','.wav','.m4a','.aif','.ogg','.opus','.ape','.aiff','.alac','.wma'])
    const out=[]
    const seen = new Set()

    function addFile(filePath){
        const normalized = path.resolve(filePath)
        if(!seen.has(normalized)){
            seen.add(normalized)
            out.push(normalized)
        }
    }

    function walk(dir){
        for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
            const full=path.join(dir,entry.name)
            if(entry.isDirectory())
                walk(full)
            else if(entry.isFile() && exts.has(path.extname(entry.name).toLowerCase()))
                addFile(full)
        }
    }

    for(const source of sources){
        const sourcePath = path.resolve(String(source))

        if(!fs.existsSync(sourcePath))
            exit(`Source does not exist: "${source}"`)

        const stat = fs.statSync(sourcePath)

        if(stat.isDirectory())
            walk(sourcePath)
        else if(stat.isFile() && exts.has(path.extname(sourcePath).toLowerCase()))
            addFile(sourcePath)
        else
            warning(`Skipping unsupported source: "${source}"`)
    }

    return out
}

async function createFingerprintDatabase(env, source, dbname, split, filesPerDatabase, threads){
    info("Scanning selected source(s)...")
    const sources = Array.isArray(source) ? source : [source]
    const files = findAudioFiles(sources)

    if(files.length === 0)
        exit("No audio files found in the selected source(s).")

    info(`Found ${files.length} audio files.`)

    const dbFolder = join(consts.DATABASE_FOLDER, dbname)
    if(!existsSync(dbFolder))
        mkdirSync(dbFolder, { recursive: true })

    const chunkSize = (split && Number(filesPerDatabase) > 0)
        ? Number(filesPerDatabase)
        : files.length

    const chunks = []
    for(let i = 0; i < files.length; i += chunkSize)
        chunks.push(files.slice(i, i + chunkSize))

    let totalIngested = 0
    let nextProgress = 5

    for(let i = 0; i < chunks.length; i++){
        const chunk = chunks[i]
        const listFile = join(
            consts.TEMP_FOLDER,
            `files_${String(i + 1).padStart(3, "0")}.txt`
        )

        writeFileSync(listFile, chunk.join("\n"), "utf8")

        const dbFile = join(
            dbFolder,
            `${dbname}_${String(i + 1).padStart(3, "0")}.pklz`
        )

        info(`Building database ${i + 1}/${chunks.length}...`)
        info(`Creator input: ${chunk.length} files`)

        let creatorStdout = ""
        let creatorStderr = ""
        let creatorLogLineBuffer = ""
        let maxDetectedWorkers = 0
        let completedHashTables = 0
        const completedHashTableIds = new Set()

        // IMPORTANT:
        // The main Creator pass is performed exactly once for this chunk.
        // We do NOT pre-scan the files and we do NOT restart the chunk when
        // Audfprint reports an unreadable file.
        await new Promise((resolve, reject) => {
            info(`Creator configured worker count: ${threads}`)

            const proc = spawn(
                env.PYTHON_COMMAND,
                [
                    consts.AUDFPRINT_PROGRAM,
                    "new",
                    "-C",
                    "--dbase", dbFile,
                    "-l", listFile,
                    "--ncores", String(threads)
                ],
                {
                    stdio: ["ignore", "pipe", "pipe"],
                    env: {
                        ...process.env,
                        PYTHONUTF8: "1",
                        PYTHONUNBUFFERED: "1"
                    }
                }
            )

            const processProgressText = textChunk => {
                creatorLogLineBuffer += textChunk.toString()

                // Audfprint can deliver stdout in arbitrary chunks. Do not
                // depend on a particular chunk boundary; parse complete lines
                // and accept harmless prefixes/whitespace around hash_table.
                const lines = creatorLogLineBuffer.split(/\r?\n/)
                creatorLogLineBuffer = lines.pop() || ""

                for(const rawLine of lines){
                    const match = rawLine.match(
                        /(?:^|\s)hash_table\s+(\d+)\s+has\s+(\d+)\s+files\s+(\d+)\s+hashes\b/i
                    )
                    if(!match) continue

                    const tableId = Number(match[1])
                    if(completedHashTableIds.has(tableId)) continue
                    completedHashTableIds.add(tableId)

                    completedHashTables++
                    const tableFiles = Number(match[2])
                    const tableHashes = Number(match[3])

                    info(
                        `[Creator] Worker table ${completedHashTables} ` +
                        `completed (${tableId}) — ${tableFiles} files | ` +
                        `${tableHashes.toLocaleString()} hashes`
                    )

                    info(
                        `[Creator] Tables completed: ${completedHashTables} | ` +
                        `Files represented: ${Math.min(
                            chunk.length,
                            completedHashTables * tableFiles
                        )} / ${chunk.length}`
                    )
                }
            }


            proc.stdout.on("data", data => {
                const chunkText = data.toString()
                creatorStdout += chunkText
                process.stdout.write(chunkText)
                processProgressText(chunkText)
            })

            proc.stderr.on("data", data => {
                const chunkText = data.toString()
                creatorStderr += chunkText
                process.stderr.write(chunkText)
                processProgressText(chunkText)
            })

            if(process.platform === "win32"){
                const creatorMonitor = setInterval(() => {
                    const ps = spawn("powershell.exe", [
                        "-NoProfile",
                        "-Command",
                        `$root=${proc.pid}; $ids=@($root); $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name; $changed=$true; while($changed){$changed=$false; foreach($p in $all){if($ids -contains [int]$p.ParentProcessId -and -not ($ids -contains [int]$p.ProcessId)){ $ids += [int]$p.ProcessId; $changed=$true }}}; ($all | Where-Object {$ids -contains [int]$_.ProcessId -and $_.Name -match "python|node"} | Measure-Object).Count`
                    ], {
                        stdio: ["ignore", "pipe", "ignore"]
                    })

                    let out = ""
                    ps.stdout.on("data", d => out += d.toString())
                    ps.on("close", () => {
                        const count = Math.max(
                            0,
                            Number.parseInt(out.trim(), 10) || 0
                        )
                        if(count > maxDetectedWorkers)
                            maxDetectedWorkers = count
                    })
                }, 1000)

                proc.once("close", () => clearInterval(creatorMonitor))
            }

            proc.on("close", code => {
                if(creatorLogLineBuffer.trim())
                    processProgressText("\n")

                if(maxDetectedWorkers > 0)
                    info(`Maximum detected Creator worker processes: ${maxDetectedWorkers}`)
                else
                    info(`Maximum detected Creator worker processes: unavailable (process exited too quickly)`)

                if(code === 0)
                    resolve()
                else
                    reject(new Error(`audfprint exited with code ${code}`))
            })
        }).catch(error => {
            // -C normally keeps audio failures from aborting the whole Creator.
            // A non-zero exit is still a real process failure and must stop.
            throw error
        })

        // Audfprint can report worker-level audio failures while the parent
        // process still exits with code 0. Collect those files from the output.
        const details = `${creatorStdout}\n${creatorStderr}`
        const failedFiles = []
        const failedSet = new Set()

        const addFailedFile = candidate => {
            if(!candidate)
                return

            let clean = candidate.trim().replace(/^["']|["']$/g, "")
            clean = clean.replace(/\s+skipping\s*$/i, "").trim()

            const normalizedCandidate = resolve(clean)

            const exact = chunk.find(file => resolve(file) === normalizedCandidate)
            if(exact){
                if(!failedSet.has(exact)){
                    failedSet.add(exact)
                    failedFiles.push(exact)
                }
                return
            }

            const byBase = chunk.filter(
                file => basename(file).toLowerCase() === basename(clean).toLowerCase()
            )

            if(byBase.length === 1 && !failedSet.has(byBase[0])){
                failedSet.add(byBase[0])
                failedFiles.push(byBase[0])
            }
        }

        // Typical Audfprint output:
        // wavfile2peaks: Error reading D:\...\file.mp3
        for(const match of details.matchAll(
            /(?:wavfile2peaks:\s*)?Error reading\s+(.+?)(?:\r?\n|$)/gi
        )){
            addFailedFile(match[1])
        }

        // Additional forms seen in audio_read/audfprint traces.
        for(const file of chunk){
            if(
                details.includes(file) &&
                /(?:wavfile2peaks|audio_read|Error reading|Failed to read)/i.test(details)
            ){
                // Only add it if the surrounding output contains an actual
                // audio-processing failure. This avoids treating ordinary
                // filenames in logs as failures.
                const escapedBase = basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                const failurePattern = new RegExp(
                    `(?:Error reading|Failed to read)[^\\r\\n]*${escapedBase}`,
                    "i"
                )

                if(failurePattern.test(details))
                    addFailedFile(file)
            }
        }

        if(failedFiles.length > 0){
            info(
                `Problematic audio detected in database ${i + 1}: ` +
                `${failedFiles.length} file(s)`
            )
            info(
                `Main Creator finished. Starting Recovery ONLY for ` +
                `${failedFiles.length} problematic file(s)...`
            )

            const recoveredAddDir = join(
                consts.TEMP_AUDIO_FOLDER,
                `creator_recovery_${String(i + 1).padStart(3, "0")}`
            )

            if(!existsSync(recoveredAddDir))
                mkdirSync(recoveredAddDir, { recursive: true })

            const recoveredForAdd = []
            let recoveredCount = 0
            let recoveryFailedCount = 0

            for(let r = 0; r < failedFiles.length; r++){
                const originalFile = failedFiles[r]

                info(
                    `[Recovery ${r + 1}/${failedFiles.length}] ` +
                    `"${basename(originalFile)}"`
                )

                const addFile = join(
                    recoveredAddDir,
                    basename(originalFile)
                )

                const recoveredFile = await recoverAudioFile(
                    env.FFMPEG_COMMAND,
                    originalFile,
                    addFile
                )

                if(!recoveredFile){
                    recoveryFailedCount++
                    warning(
                        `Recovery failed: "${basename(originalFile)}" ` +
                        `— file will remain outside the database`
                    )
                    continue
                }

                try{
                    if(!recoveredFile)
                        throw new Error('Recovery returned no output file')

                    // recoverAudioFile() wrote directly to the final ADD path.
                    // No second full-size copy is created.
                    recoveredForAdd.push(addFile)
                    recoveredCount++
                    success(
                        `Recovery verified: "${basename(originalFile)}"`
                    )
                }
                catch(error){
                    recoveryFailedCount++
                    if(existsSync(addFile))
                        rmSync(addFile, { force: true })
                    warning(
                        `Recovered file could not be verified: ` +
                        `"${basename(originalFile)}"`
                    )
                }
            }

            if(recoveredForAdd.length > 0){
                const addListFile = join(
                    consts.TEMP_FOLDER,
                    `recovered_${String(i + 1).padStart(3, "0")}.txt`
                )

                writeFileSync(
                    addListFile,
                    recoveredForAdd.join("\n"),
                    "utf8"
                )

                info(
                    `Adding ${recoveredForAdd.length} recovered file(s) ` +
                    `to ${basename(dbFile)}...`
                )

                const addStdout = []
                const addStderr = []

                await new Promise((resolve, reject) => {
                    const proc = spawn(
                        env.PYTHON_COMMAND,
                        [
                            consts.AUDFPRINT_PROGRAM,
                            "add",
                            "-C",
                            "--dbase", dbFile,
                            "-l", addListFile,
                            "--ncores", String(threads)
                        ],
                        {
                            stdio: ["ignore", "pipe", "pipe"],
                            env: {
                                ...process.env,
                                PYTHONUTF8: "1"
                            }
                        }
                    )

                    proc.stdout.on("data", data => {
                        const value = data.toString()
                        addStdout.push(value)
                        process.stdout.write(value)
                    })

                    proc.stderr.on("data", data => {
                        const value = data.toString()
                        addStderr.push(value)
                        process.stderr.write(value)
                    })

                    proc.on("close", code => {
                        if(code === 0)
                            resolve()
                        else
                            reject(
                                new Error(
                                    `audfprint add exited with code ${code}`
                                )
                            )
                    })
                }).catch(error => {
                    warning(
                        `Failed to add recovered files to "${basename(dbFile)}": ` +
                        `${error.message}`
                    )
                })

                if(existsSync(addListFile))
                    unlinkSync(addListFile)
            }

            success(
                `Recovery completed for database ${i + 1}: ` +
                `${recoveredCount}/${failedFiles.length} recovered`
            )

            if(recoveryFailedCount > 0){
                warning(
                    `Still failed after recovery: ` +
                    `${recoveryFailedCount} file(s)`
                )
            }
        }
        else{
            info(`No problematic audio detected in database ${i + 1}.`)
        }

        if(nextProgress <= 100 && i === chunks.length - 1){
            info(`Creator progress: 100% (${files.length} / ${files.length})`)
            nextProgress = 105
        }

        if(existsSync(listFile))
            unlinkSync(listFile)

        success(`Created ${dbFile}`)
    }

    success(`Created ${chunks.length} database(s).`)
    success("Fingerprint Creator v7 completed.")
}
async function init(){
    process.stdin.pause();
    let {
    duration,
    extension,
    database,
    threads,
    trim,
    speed,
    trimFirst,
    trimMiddle,
    fingerprint,
    source,
    dbname,
    split,
    filesPerDatabase
} = argv

const multiSpeed = argv['multi-speed']
info(`DEBUG argv = ${JSON.stringify(argv)}`)

    info("Welcome to WerZatSong v2.0")
    info("Original project by Nel with contributions from Numerophobe, AzureBlast and Mystic65")
    info("GUI & v2.0 Enhancements by Topek")
    setupFolders()
    const env = fetchEnvironment()

    // Search and Creator have completely independent thread settings.
    let settingsThreads = "auto"
    let settingsCreatorThreads = "auto"

    try{

        const settings = JSON.parse(
            readFileSync(join(__dirname, "settings.json"), "utf8")
        )

        settingsThreads = settings.threads ?? "auto"
        settingsCreatorThreads = settings.creator_threads ?? "auto"

    }catch{}

    if (fingerprint) {

        let creatorThreads

        if(!isNaN(threads) && threads > 0){

            // Explicit CLI value wins.

            creatorThreads = Number(threads)

        }else if(settingsCreatorThreads === "auto"){

            const os = require("node:os")
            const cpuThreads = availableParallelism()
            const ramGB = Math.max(1, Math.round(os.totalmem() / (1024 ** 3)))

            // 28 CPU / 16 GB RAM -> 10 Creator threads.
            const cpuLimit = Math.max(2, cpuThreads - 18)
            const ramLimit = Math.max(2, Math.floor(ramGB * 0.75))
            creatorThreads = Math.min(cpuThreads, cpuLimit, ramLimit)

            info(`Auto Creator: ${cpuThreads} CPU threads, ${ramGB} GB RAM -> ${creatorThreads} threads`)
            info(`Auto mode: avoid heavy work on the computer while Creator is running.`)

        }else{

            creatorThreads = Number(settingsCreatorThreads)

        }

        info(`Using ${creatorThreads} concurrent threads for database creation`)

        const creatorStartTime = Date.now()

        await createFingerprintDatabase(
            env,
            source,
            dbname,
            split,
            filesPerDatabase,
            creatorThreads
        )

        const elapsed = Math.round((Date.now() - creatorStartTime) / 1000)
        const minutes = Math.floor(elapsed / 60)
        const seconds = elapsed % 60

        success(
            `Total creation time: ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        )

        return

    }

    // Search keeps its original independent setting.
    if(!isNaN(threads) && threads > 0){

        // use CLI value

    }else if(settingsThreads === "auto"){

        const os = require("node:os")
        const cpuThreads = availableParallelism()
        const ramGB = Math.max(1, Math.round(os.totalmem() / (1024 ** 3)))

        // 28 CPU / 16 GB RAM -> 20 Search threads.
        const cpuLimit = Math.max(2, cpuThreads - 8)
        const ramLimit = Math.max(2, Math.floor(ramGB * 1.375))
        threads = Math.min(cpuThreads, cpuLimit, ramLimit)

        info(`Auto Search: ${cpuThreads} CPU threads, ${ramGB} GB RAM -> ${threads} threads`)
        info(`Auto mode: avoid heavy work on the computer while Search is running.`)

    }else{

        threads = Number(settingsThreads)

    }
    const modes = parseModes()
    if(modes.includes(Mode.AUDIOTAG)){
        const validatedAudiotag = await validateAudiotag(env.AUDIOTAG_KEY)
        if(validatedAudiotag){
            env.AUDIOTAG_KEY = validatedAudiotag
            success('Audiotag API key has been set successfully in .env file')
        }
    }
    if(modes.includes(Mode.MUSICBRAINZ)){
        const validatedMusicbrainz = await validateMusicbrainz(env.ACOUSTID_KEY)
        if(validatedMusicbrainz){
            env.ACOUSTID_KEY = validatedMusicbrainz
            success('AcoustID API key has been set successfully in .env file')
        }
        extension = validateExtension(extension)
        duration = validateDuration(duration)
    }
    if(modes.includes(Mode.AUDFPRINT)){
        setupAudfprint(database)
    }
    const { audioFiles, precomputedFiles } = loadSamples(modes)
    if(!isNaN(Number(speed)) && Number(speed)!==0)
        info(`Speed correction: ${Number(speed)>0?'+':''}${Number(speed)}%`)
    if(trimFirst)
        info('Trim First enabled (75 sec)')
    if(trimMiddle)
        info('Trim Middle enabled (45 sec)')
    const { afpts, mp3s } = await generateFiles(env, trim, speed, multiSpeed, trimFirst, trimMiddle, modes, audioFiles, precomputedFiles)
    if(modes.some(mode => mode !== Mode.AUDFPRINT)){
        const mp3Modes = modes.filter(mode => mode !== Mode.AUDFPRINT)
        info(`Searching ${mp3s.length} MP3 files with mode${mp3Modes.length > 1 ? 's' : ''}: ${mp3Modes.join(', ')}`)
        if(trim > 0)
            info(`MP3 files will be shortened to ${trim} seconds for all search modes`)
        if(modes.includes(Mode.MUSICBRAINZ)){
            const [minDuration, maxDuration] = duration.split(':').map(Number)
            info(`Mode ${Mode.MUSICBRAINZ} will be searching for tracks with duration ranges between ${minDuration} and ${maxDuration} seconds`)
            info(`Mode ${Mode.MUSICBRAINZ} will be extending tracks between 0 and ${extension} seconds during the searches`)
        }
        for(const mp3 of mp3s){
            const basenameMp3 = basename(mp3)
            if(modes.includes(Mode.MUSICBRAINZ)){
                info(`Searching "${basenameMp3}" with ${Mode.MUSICBRAINZ} mode`)
                await musicbrainz(env, mp3, extension, duration)
            }
            if(modes.includes(Mode.AUDIOTAG)){
                info(`Searching "${basenameMp3}" with ${Mode.AUDIOTAG} mode`)
                await audiotag(env, mp3)
            }
            if(modes.includes(Mode.SHAZAM)){
                info(`Searching "${basenameMp3}" with ${Mode.SHAZAM} mode`)
                await shazam(env, mp3)
            }
        }
    }
    if(modes.includes(Mode.AUDFPRINT)){
        if(afpts.length === 0)
            exit(`In ${Mode.AUDFPRINT} mode, at least one valid precomputed AFPT file is required`)
        writeFileSync(consts.AFPTS_FILE, afpts.join('\n'))
        info(`Searching ${afpts.length} precomputed audio files with ${Mode.AUDFPRINT} mode`)
        const pklzCount = readFileSync(consts.PKLZS_FILE, 'utf-8').trim().split('\n').length
        info(`Loaded a total of ${pklzCount} PKLZ files`)
        await audfprint(env, threads)
        info(`Search completed with ${Mode.AUDFPRINT} mode, now analyzing results... Please wait and do not close the program`)
        await createAudfprintLogs(env)
    }
    if(existsSync(RESULTS_FOLDER) && readdirSync(RESULTS_FOLDER).some(file => extname(file) === '.txt'))
        info(`Execution complete! Check logs results in: ${RESULTS_FOLDER}`)
    else
        info('Execution complete! Unfortunately, no results were found')
}


async function start(){

    try{

        await init()

    }
    finally{

        if(existsSync(consts.TEMP_AUDIO_FOLDER)){

            rmSync(
                consts.TEMP_AUDIO_FOLDER,
                {
                    recursive:true,
                    force:true
                }
            )

            mkdirSync(consts.TEMP_AUDIO_FOLDER)

            info("Temporary files cleaned.")

        }

    }

}

start()
