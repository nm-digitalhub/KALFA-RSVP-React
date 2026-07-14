require(Modules.Call);

VoxEngine.addEventListener(AppEvents.CallAlerting, (e) => {
  const call = e.call;
  call.answer();
  
  call.addEventListener(CallEvents.Connected, () => {
    call.say("ברוכים הבאים למערכת אישורי ההגעה של קלפא", Language.Hebrew.Female);
  });
});
