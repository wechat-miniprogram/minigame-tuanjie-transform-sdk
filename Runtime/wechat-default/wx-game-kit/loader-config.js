const loaderConfig = JSON.parse(wx.getFileSystemManager().readFileSync('wx-game-kit/config.json', 'utf-8'));
export default loaderConfig;
