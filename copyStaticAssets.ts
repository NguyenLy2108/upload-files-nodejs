import * as shell from 'shelljs';

shell.cp(
  '-R',
  'src/watermark',
  'dist/src',
);
