/**
 * 模板引擎使用教程可见：https://wechat-miniprogram.github.io/minigame-canvas-engine/tutorial/templateengine.html
 * xml经过doT.js编译出的模板函数
 * 因为小游戏不支持new Function，模板函数只能外部编译
 * 可直接拷贝本函数到小游戏中使用
 * 原始的模板如下：
 *
<view class="container" id="main">
  <view class="rankList">
    <scrollview class="list" scrollY="true">
      {{~it.data :item:index}}
        <view class="listItem">
          <image src="open-data/render/image/rankBg.png" class="rankBg"></image>
          <image class="rankAvatarBg" src="open-data/render/image/rankAvatar.png"></image>
          <image class="rankAvatar" src="{{= item.avatarUrl }}"></image>
          <view class="rankNameView">
            <image class="rankNameBg" src="open-data/render/image/nameBg.png"></image>
            <text class="rankName" value="{{=item.nickname}}"></text>
            <text class="rankScoreTip" value="战力值:"></text>
            <text class="rankScoreVal" value="{{=item.score || 0}}"></text>
          </view>
          <view class="shareToBtn" data-isSelf="{{= item.isSelf ? true : false}}" data-id="{{= item.openid || ''}}">
            <image src="open-data/render/image/{{= item.isSelf ? 'button3':'button2'}}.png" class="shareBtnBg"></image>
            <text class="shareText" value="{{= item.isSelf ? '你自己' : '分享'}}"></text>
          </view>
        </view>
      {{~}}
    </scrollview>
  </view>
</view>

 *
 */
export default function tplFunc(it) {
    var out = '<view class="container" id="main"> <view class="rankList"> <scrollview class="list" scrollY="true"> ';
    var arr1 = it.data;
    if (arr1) {
        var item, index = -1, l1 = arr1.length - 1;
        while (index < l1) {
            item = arr1[index += 1];
            out += ' <view class="listItem"> <image src="open-data/render/image/rankBg.png" class="rankBg"></image> <image class="rankAvatarBg" src="open-data/render/image/rankAvatar.png"></image> <image class="rankAvatar" src="' + (item.avatarUrl) + '"></image> <view class="rankNameView"> <image class="rankNameBg" src="open-data/render/image/nameBg.png"></image> <text class="rankName" value="' + (item.nickname) + '"></text> <text class="rankScoreTip" value="战力值:"></text> <text class="rankScoreVal" value="' + (item.score || 0) + '"></text> </view> <view class="shareToBtn" data-isSelf="' + (item.isSelf ? true : false) + '" data-id="' + (item.openid || '') + '"> <image src="open-data/render/image/' + (item.isSelf ? 'button3' : 'button2') + '.png" class="shareBtnBg"></image> <text class="shareText" value="' + (item.isSelf ? '你自己' : '分享') + '"></text> </view> </view> ';
        }
    }
    out += ' </scrollview> </view></view>';
    return out;
}
