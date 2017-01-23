function NetworkConnection(easyrtc, socketUrl) {
  this.socketUrl = socketUrl
  this.appId = '';
  this.roomId = '';
  this.myEasyrtcid = "";
  this.myRoomJoinTime = 0; // TODO: This should be received from the server
  this.connectList = {};
  this.channelIsActive = {};
  this.networkEntities = {};
  this.magicEntities = true;
  this.debug = false;
  this.easyrtc = easyrtc;
}

/* Must be called before connect */
NetworkConnection.prototype.enableDebugging = function(enable) {
  this.debug = enable;
};

NetworkConnection.prototype.enableMagicEntities = function(enable) {
  this.magicEntities = enable;
};
/* ------------------------------ */

NetworkConnection.prototype.connect = function(appId, roomId, enableAudio = false) {
  this.appId = appId;
  this.roomId = roomId;

  this.easyrtc.enableDebug(this.debug);
  this.easyrtc.enableDataChannels(true);
  this.easyrtc.enableVideo(false);
  this.easyrtc.enableAudio(enableAudio);
  this.easyrtc.enableVideoReceive(false);
  this.easyrtc.enableAudioReceive(enableAudio);

  this.easyrtc.setDataChannelOpenListener(this.dcOpenListener.bind(this));
  this.easyrtc.setDataChannelCloseListener(this.dcCloseListener.bind(this));
  this.easyrtc.setPeerListener(this.dataReceived.bind(this));
  this.easyrtc.setRoomOccupantListener(this.occupantsReceived.bind(this));

  this.easyrtc.setSocketUrl(this.socketUrl);
  this.easyrtc.joinRoom(roomId, null);

  if (enableAudio) {
    this.connectAudio();
  } else {
    this.easyrtc.connect(this.appId,
      this.loginSuccess.bind(this), this.loginFailure.bind(this));
  }
};

NetworkConnection.prototype.connectAudio = function() {
  this.easyrtc.setStreamAcceptor(function(easyrtcid, stream) {
    var audioEl = document.createElement("audio");
    audioEl.setAttribute('id', 'audio-' + easyrtcid);
    document.body.appendChild(audioEl);
    this.easyrtc.setVideoObjectSrc(audioEl,stream);
  });

  this.easyrtc.setOnStreamClosed(function (easyrtcid) {
    var audioEl = document.getElementById('audio-' + easyrtcid);
    audioEl.parentNode.removeChild(audioEl);
  });

  var that = this;
  this.easyrtc.initMediaSource(
    function(){
      that.easyrtc.connect(that.appId,
        that.loginSuccess.bind(that), that.loginFailure.bind(that));
    },
    function(errorCode, errmesg){
      console.error(errorCode, errmesg);
    }
  );
};

// NetworkConnection.prototype.gatherNetworkEntitiesFromDOM = function() {
//   var networkEntities = document.querySelector('[network-component]');
//   for (var entity in networkEntities) {
//     var networkId = entity.components['network-component'].networkId;
//     this.networkEntities[networkId] = entity;
//   }
// };

NetworkConnection.prototype.setupMagicEntities = function () {
  var templateName, template;

  templateName = '#avatar';
  template = document.querySelector('script' + templateName);
  if (template) {
    var entity = this.createNetworkEntity(templateName, '0 0 0', '0 0 0 0');
    entity.setAttribute('hide-geometry', '');
    entity.setAttribute('follow-camera', '');
  }
};

NetworkConnection.prototype.loginSuccess = function(easyrtcid) {
  this.myEasyrtcid = easyrtcid;
  if (this.magicEntities) {
    this.setupMagicEntities();
  }
};

NetworkConnection.prototype.loginFailure = function(errorCode, message) {
  console.error(errorCode, "failure to login");
};

NetworkConnection.prototype.occupantsReceived = function(roomName, occupantList, isPrimary) {
  this.connectList = occupantList;
  console.log('Connected clients', this.connectList);

  for (var easyrtcid in this.connectList) {
    if (this.isNewClient(easyrtcid) && this.myClientShouldStartCall(easyrtcid)) {
      this.startCall(easyrtcid);
    }
  }
};

NetworkConnection.prototype.isNewClient = function(user) {
  return !this.channelIsActive.hasOwnProperty(user) && this.isNotConnectedTo(user);
};

NetworkConnection.prototype.isNotConnectedTo = function(user) {
  return this.easyrtc.getConnectStatus(user) === easyrtc.NOT_CONNECTED;
};

NetworkConnection.prototype.myClientShouldStartCall = function(otherUser) {
  var otherUserTimeJoined = this.connectList[otherUser].roomJoinTime;
  return this.myRoomJoinTime <= otherUserTimeJoined;
};

NetworkConnection.prototype.startCall = function(otherEasyrtcid) {
  var that = this;
  this.easyrtc.call(otherEasyrtcid,
      function(caller, media) {
        if (media === 'datachannel') {
          console.log("Made call succesfully to " + caller);
          // TODO change this so the user's data isn't overwritten by true/false
          that.connectList[otherEasyrtcid] = true;
        }
      },
      function(errorCode, errorText) {
        that.connectList[otherEasyrtcid] = false;
        console.error(errorCode, errorText);
      },
      function(wasAccepted) {
        // console.log("was accepted=" + wasAccepted);
      }
  );
};

NetworkConnection.prototype.isConnectedTo = function(user) {
  return this.connectList.hasOwnProperty(user) && this.connectList[user];
};

NetworkConnection.prototype.dcOpenListener = function(user) {
  console.log('Opened data channel from ' + user);
  this.channelIsActive[user] = true;
  this.syncEntities();
};

NetworkConnection.prototype.dcCloseListener = function(user) {
  console.log('Closed data channel from ' + user);
  this.channelIsActive[user] = false;
  this.removeNetworkEntitiesFromUser(user);
};

NetworkConnection.prototype.dcIsConnectedTo = function(user) {
  return this.channelIsActive.hasOwnProperty(user) && this.channelIsActive[user];
};

NetworkConnection.prototype.broadcastData = function(dataType, data) {
  for (var easyrtcid in this.connectList) {
    this.sendData(easyrtcid, dataType, data);
  }
};

NetworkConnection.prototype.sendData = function(user, dataType, data) {
  if (this.easyrtc.getConnectStatus(user) === easyrtc.IS_CONNECTED) {
    this.easyrtc.sendDataP2P(user, dataType, data);
  } else {
    // console.error("NOT-CONNECTED", "not connected to " + easyrtc.idToName(otherEasyrtcid));
  }
};

NetworkConnection.prototype.dataReceived = function(fromClient, dataType, data) {
  // console.log('Data received', fromUser, dataType, data);
  if (dataType == 'sync-entity') {
    this.syncEntityFromRemote(data);
  } else if (dataType == 'remove-entity') {
    this.removeNetworkEntity(data);
  }
};

NetworkConnection.prototype.syncEntityFromRemote = function(entityData) {
  if (this.networkEntities.hasOwnProperty(entityData.networkId)) {
    this.networkEntities[entityData.networkId].components['network-component'].syncFromRemote(entityData);
  } else {
    this.createLocalNetworkEntity(entityData);
  }
};

NetworkConnection.prototype.syncEntities = function() {
  for (var networkId in this.networkEntities) {
    if (this.networkEntities.hasOwnProperty(networkId)) {
      this.networkEntities[networkId].emit('sync', null, false);
    }
  }
};

NetworkConnection.prototype.createNetworkEntity = function(template, position, rotation) {
  var networkId = this.createNetworkEntityId();
  var entityData = {
    networkId: networkId,
    owner: this.myEasyrtcid,
    template: template,
    position: position,
    rotation: rotation,
  };
  this.broadcastData('sync-entity', entityData);
  var entity = this.createLocalNetworkEntity(entityData);
  return entity;
};

NetworkConnection.prototype.createLocalNetworkEntity = function(entityData) {
  var scene = document.querySelector('a-scene');
  var entity = document.createElement('a-entity');
  entity.setAttribute('template', 'src:' + entityData.template);
  entity.setAttribute('position', entityData.position);
  entity.setAttribute('rotation', entityData.rotation);
  entity.setAttribute('network-component', 'owner:' + entityData.owner + ';networkId:' + entityData.networkId);
  scene.appendChild(entity);
  this.networkEntities[entityData.networkId] = entity;
  return entity;
};

NetworkConnection.prototype.createNetworkEntityId = function() {
  return Math.random().toString(36).substring(0, 7);
};

NetworkConnection.prototype.removeNetworkEntitiesFromUser = function(user) {
  for (var id in this.networkEntities) {
    var networkComponent = this.networkEntities[id].components['network-component'];
    if (networkComponent.data.owner == user) {
      this.removeNetworkEntity(id);
    }
  }
};

NetworkConnection.prototype.removeNetworkEntity = function(user) {
  var entity = this.networkEntities[user];
  delete this.networkEntities[user];
  entity.parentNode.removeChild(entity);
};

module.exports = NetworkConnection;