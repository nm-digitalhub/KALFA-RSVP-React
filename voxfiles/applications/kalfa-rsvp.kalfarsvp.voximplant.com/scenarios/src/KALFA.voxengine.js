// connect the CallList module to work with call lists
require(Modules.CallList);

// connect the Player module to play audio files during the call
require(Modules.Player);

let call;
let player;

// the event is triggered when the application starts
VoxEngine.addEventListener(AppEvents.Started, () => {

  // data from the call list is presented as a JSON string
  // we can get it using the VoxEngine.customData() method

  // convert the JSON string to an object and parse it
  // the phone constant contains phone numbers from the call list
  const { phoneNumber } = JSON.parse(VoxEngine.customData());

  // call the phone numbers from the call list
  call = VoxEngine.callPSTN(phoneNumber, 'default');
  // if the phone number is registered as a callerid, it can be called from the application by specifying 'default' as the second argument

  // the event is triggered when a callee picks up the phone
  call.addEventListener(CallEvents.Connected, () => {

    // create a new instance of the player URL. Use an mp3 file link as an argument
    player = VoxEngine.createURLPlayer('https://cdn.voximplant.com/3rd_template_en.mp3');

    // add the PlaybackFinished event handler to the call. This event is triggered when the audio playback ends
    player.addEventListener(PlayerEvents.PlaybackFinished, () => {
      // in this example, we end the call
      call.hangup();
    });

    // send media data to the call when it is answered
    player.sendMediaTo(call);

    // the 'record()' method starts recording the conversation and triggers the 'CallEvents.RecordStarted' event
    call.record();
  });

  // the event is triggered when we hang up
  call.addEventListener(CallEvents.Disconnected, async e => {
    // in this case, the call is considered successful. Write the result to the call list and stop calls to this phone number
    await CallList.reportResult({ result: e });

    // the 'terminate()' method terminates the current JavaScript session
    VoxEngine.terminate();
  });

  // the event is triggered when it is not possible to call a phone number
  call.addEventListener(CallEvents.Failed, async e => {
    // in this case, the call is considered unsuccessful. Write the information about the error to the call list and continue dialing attempts, if this attempt is not the last one
    await CallList.reportError({ result: e });

    // the 'terminate()' method terminates the current JavaScript session
    VoxEngine.terminate();
  });
});