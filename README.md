# 微信小游戏Unity/团结引擎SDK

有关微信SDK的最新特性与使用请阅读 [Unity WebGL 微信小游戏适配方案](https://wechat-miniprogram.github.io/minigame-unity-webgl-transform/)。

## 安装指南

使用Unity引擎或[团结引擎](https://unity.cn/tuanjie/tuanjieyinqing)创建/打开游戏工程，
Unity Editor 菜单栏 `Window` - `Package Manager` - `右上 + 按钮` - `Add package from git URL...` 输入本仓库Git资源地址即可。

如：`https://github.com/wechat-miniprogram/minigame-tuanjie-transform-sdk.git`

## 常见问题

#### 1.游戏工程可以导出但在微信开发者工具运行提示报错：
常见的情况是发生在如空项目或游戏代码中从未使用WXSDK的任何Runtime能力时，团结引擎导出项目将微信Runtime包裁剪，解决办法是在游戏合理位置增加对WXSDK的使用即可。
