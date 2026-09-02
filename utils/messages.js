const chalk = require('chalk')

const Message = {
    EMPTY: chalk.gray,
    ERROR: chalk.redBright,
    INFO: chalk.cyan,
    SUCCESS: chalk.greenBright,
    POSSIBLE: chalk.hex('#ff9900'),
    WARNING: chalk.yellow
}

function empty(message){
    console.log(Message.EMPTY(`[EMPTY]: ${message}`))
}

function exit(message){
    console.error(Message.ERROR(`[ERROR]: ${message}`))
    process.exit(1)
}

function info(message){
    console.log(Message.INFO(`[INFO]: ${message}`))
}

function success(message){
    console.log(chalk.greenBright(message))
}

function possible(message){
    console.log(Message.POSSIBLE(message))
}

function warning(message){
    console.log(Message.WARNING(`[WARNING]: ${message}`))
}

module.exports = { empty, exit, info, success, possible, warning }
