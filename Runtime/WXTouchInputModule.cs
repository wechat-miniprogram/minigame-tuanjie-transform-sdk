#if UNITY_WEBGL || WEIXINMINIGAME || UNITY_EDITOR
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/**
 * WxTouch输入模块，结合 WXTouchInputOverride 使用 
 * 用于拦截所有Button事件调用，确保事件只被触发一次，避免重复触发问题
 * 除会拦截带 Button 组件的 ExecuteEvents.pointerClickHandler 事件外，逻辑与 StandaloneInputModule 均一致
 * 需要在场景中添加 WXTouchInputOverride 组件使用，且保证不要有其他的 StandaloneInputModule
 */
public class WXTouchInputModule : StandaloneInputModule
{
    private const float doubleClickTime = 0.3f;

    public override void Process()
    {
        if (!eventSystem.isFocused && ShouldIgnoreEventsOnNoFocus())
            return;
        bool usedEvent = SendUpdateEventToSelectedObject();
        if (!ProcessTouchEvents() && input.mousePresent)
            ProcessMouseEvent();
        if (eventSystem.sendNavigationEvents)
        {
            if (!usedEvent)
                usedEvent |= SendMoveEventToSelectedObject();

            if (!usedEvent)
                SendSubmitEventToSelectedObject();
        }
    }

    private bool ShouldIgnoreEventsOnNoFocus()
    {
#if UNITY_EDITOR
        return !UnityEditor.EditorApplication.isRemoteConnected;
#else
        return true;
#endif
    }

    private bool ProcessTouchEvents()
    {
        for (int i = 0; i < input.touchCount; ++i)
        {
            Touch touch = input.GetTouch(i);
            if (touch.type == TouchType.Indirect)
                continue;

            bool released;
            bool pressed;
            var pointer = GetTouchPointerEventData(touch, out pressed, out released);

            ProcessTouchPress(pointer, pressed, released);

            if (!released)
            {
                ProcessMove(pointer);
                ProcessDrag(pointer);
            }
            else
                RemovePointerData(pointer);
        }
        return input.touchCount > 0;
    }

    // released 后会拦截 Button 的 ExecuteEvents.pointerClickHandler ，其余逻辑与 StandaloneInputModule 保持一致
    protected new void ProcessTouchPress(PointerEventData pointerEvent, bool pressed, bool released)
    {
        var currentOverGo = pointerEvent.pointerCurrentRaycast.gameObject;

        // PointerDown notification
        if (pressed)
        {
            pointerEvent.eligibleForClick = true;
            pointerEvent.delta = Vector2.zero;
            pointerEvent.dragging = false;
            pointerEvent.useDragThreshold = true;
            pointerEvent.pressPosition = pointerEvent.position;
            pointerEvent.pointerPressRaycast = pointerEvent.pointerCurrentRaycast;

            DeselectIfSelectionChanged(currentOverGo, pointerEvent);

            if (pointerEvent.pointerEnter != currentOverGo)
            {
                // send a pointer enter to the touched element if it isn't the one to select...
                HandlePointerExitAndEnter(pointerEvent, currentOverGo);
                pointerEvent.pointerEnter = currentOverGo;
            }

            var resetDiffTime = Time.unscaledTime - pointerEvent.clickTime;
            if (resetDiffTime >= doubleClickTime)
            {
                pointerEvent.clickCount = 0;
            }

            // search for the control that will receive the press
            // if we can't find a press handler set the press
            // handler to be what would receive a click.
            var newPressed = ExecuteEvents.ExecuteHierarchy(currentOverGo, pointerEvent, ExecuteEvents.pointerDownHandler);

            var newClick = ExecuteEvents.GetEventHandler<IPointerClickHandler>(currentOverGo);

            // didnt find a press handler... search for a click handler
            if (newPressed == null)
                newPressed = newClick;

            // Debug.Log("Pressed: " + newPressed);

            float time = Time.unscaledTime;

            if (newPressed == pointerEvent.lastPress)
            {
                var diffTime = time - pointerEvent.clickTime;
                if (diffTime < doubleClickTime)
                    ++pointerEvent.clickCount;
                else
                    pointerEvent.clickCount = 1;

                pointerEvent.clickTime = time;
            }
            else
            {
                pointerEvent.clickCount = 1;
            }

            pointerEvent.pointerPress = newPressed;
            pointerEvent.rawPointerPress = currentOverGo;
            pointerEvent.pointerClick = newClick;

            pointerEvent.clickTime = time;

            // Save the drag handler as well
            pointerEvent.pointerDrag = ExecuteEvents.GetEventHandler<IDragHandler>(currentOverGo);

            if (pointerEvent.pointerDrag != null)
                ExecuteEvents.Execute(pointerEvent.pointerDrag, pointerEvent, ExecuteEvents.initializePotentialDrag);
        }

        // PointerUp notification
        if (released)
        {
            // Debug.Log("Executing pressup on: " + pointer.pointerPress);
            ExecuteEvents.Execute(pointerEvent.pointerPress, pointerEvent, ExecuteEvents.pointerUpHandler);
            // Debug.Log("KeyCode: " + pointer.eventData.keyCode);

            // see if we mouse up on the same element that we clicked on...
            var pointerClickHandler = ExecuteEvents.GetEventHandler<IPointerClickHandler>(currentOverGo);

            // PointerClick and Drop events
            if (pointerEvent.pointerClick == pointerClickHandler && pointerEvent.eligibleForClick)
            {
                bool shouldHandleInWx = currentOverGo != null && currentOverGo.GetComponentInParent<UnityEngine.UI.Button>() != null;
                if (!shouldHandleInWx)
                {
                    ExecuteEvents.Execute(pointerEvent.pointerClick, pointerEvent, ExecuteEvents.pointerClickHandler);
                }
            }

            if (pointerEvent.pointerDrag != null && pointerEvent.dragging)
            {
                ExecuteEvents.ExecuteHierarchy(currentOverGo, pointerEvent, ExecuteEvents.dropHandler);
            }

            pointerEvent.eligibleForClick = false;
            pointerEvent.pointerPress = null;
            pointerEvent.rawPointerPress = null;
            pointerEvent.pointerClick = null;

            if (pointerEvent.pointerDrag != null && pointerEvent.dragging)
                ExecuteEvents.Execute(pointerEvent.pointerDrag, pointerEvent, ExecuteEvents.endDragHandler);

            pointerEvent.dragging = false;
            pointerEvent.pointerDrag = null;

            // send exit events as we need to simulate this on touch up on touch device
            ExecuteEvents.ExecuteHierarchy(pointerEvent.pointerEnter, pointerEvent, ExecuteEvents.pointerExitHandler);
            pointerEvent.pointerEnter = null;
        }

        //m_InputPointerEvent = pointerEvent;
    }
}
#endif