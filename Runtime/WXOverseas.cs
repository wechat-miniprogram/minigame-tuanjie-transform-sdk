#if UNITY_WEBGL || WEIXINMINIGAME || UNITY_EDITOR
namespace WeChatWASM.Overseas
{
    /// <summary>
    /// 出海小游戏支付 API
    /// </summary>
    public static class WXOverseas
    {
        /// <summary>
        /// 出海小游戏发起游戏币支付
        /// </summary>
        public static void RequestGamePayment(RequestGamePaymentOption option)
        {
            WXSDKManagerHandler.Instance.RequestGamePayment(option);
        }

        /// <summary>
        /// 出海小游戏查询支付商品信息
        /// </summary>
        public static void GetGamePaymentProductInfo(GetGamePaymentProductInfoOption option)
        {
            WXSDKManagerHandler.Instance.GetGamePaymentProductInfo(option);
        }

        /// <summary>
        /// 出海小游戏发起道具直购支付
        /// </summary>
        public static void RequestPaymentGameItem(RequestPaymentGameItemOption option)
        {
            WXSDKManagerHandler.Instance.RequestPaymentGameItem(option);
        }
    }
}
#endif
