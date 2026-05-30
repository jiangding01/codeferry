import chalk from 'chalk';

const DEBUG = process.env.DRIFT_DEBUG === 'true';

export const log = {
  info(msg: string) {
    console.log(chalk.cyan('ℹ'), msg);
  },
  success(msg: string) {
    console.log(chalk.green('✔'), msg);
  },
  warn(msg: string) {
    console.log(chalk.yellow('⚠'), msg);
  },
  error(msg: string) {
    console.error(chalk.red('✘'), msg);
  },
  debug(msg: string) {
    if (DEBUG) {
      console.log(chalk.gray('  [debug]'), chalk.gray(msg));
    }
  },
  dim(msg: string) {
    console.log(chalk.gray(msg));
  },
  blank() {
    console.log();
  },
};
