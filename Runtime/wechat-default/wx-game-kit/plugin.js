import './weapp-adapter';
import checkVersion from './check-version';
import config from './loader-config';

const WXGameKit = requirePlugin('WXGameKit', {
  enableRequireHostModule: true,
  customEnv: {
    wx,
    document,
    canvas,
    navigator: GameGlobal.navigator,
    XMLHttpRequest: GameGlobal.XMLHttpRequest,
    WXWASMSDK: GameGlobal.WXWASMSDK,
  }
}).default

GameGlobal.WXGameKit = WXGameKit;

GameGlobal.WXGameKit.loadConfig(config);

if (checkVersion()) {
  GameGlobal.WXGameKit.init();
  GameGlobal.WXGameKit.loader = new GameGlobal.WXGameKit.Loader();
}
