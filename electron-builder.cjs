module.exports = {
  appId:'app.mathmyth.desktop',productName:'Mathmyth',directories:{output:require('node:path').join(__dirname,'artifacts/desktop')},
  electronVersion:require('./node_modules/electron/package.json').version,
  electronDist:require('node:path').join(__dirname,'node_modules/electron/dist'),
  files:['dist/**/*','electron/main.cjs','electron/preload.cjs','package.json','!node_modules/**/*'],
  extraMetadata:{main:'electron/main.cjs'},asar:true,
  npmRebuild:false,
  win:{target:[{target:'nsis',arch:['x64']}],artifactName:'Mathmyth-v${version}-Setup.${ext}',signExecutable:false,icon:require('node:path').join(__dirname,'public/mathmyth.ico')},
  nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:false},
  publish:null,
};
