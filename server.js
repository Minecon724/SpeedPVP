const { i } = require('mathjs');
const mc = require('minecraft-protocol');
const Chunk = require('prismarine-chunk')('1.8.9');
const World = require('prismarine-world')('1.8.9');
const registry = require('prismarine-registry')('1.8.9');
const Block = require('prismarine-block')(registry);
const Vec3 = require('vec3');
const settings = {
  spawnX: 7.5,
  spawnY: 55,
  spawnZ: 7.5,
  spawnYaw: 0,
  spawnPitch: 0,
  worldSize: 128,
  hitDelay: 250,
  knockback: {
    default: [ 2500, 1500, 2500 ],
    sprintFirstHit: [ 3500, 2000, 3500 ],
  }
}

const server = mc.createServer({
  'online-mode': false,
  host: 'localhost',
  port: 25565,
  version: '1.8.9'
});

function generateChunk(x, z) {
  const chunk = new Chunk();
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      chunk.setBlockType(new Vec3(x, 49, z), 3);
      for (let y = 0; y < 256; y++) {
        chunk.setSkyLight(new Vec3(x, y, z), 15);
      }
    }
  }
  return chunk;
}

function isInsideBorder(x, z) {
  if (settings.worldSize < x || -settings.worldSize > x || settings.worldSize < z || -settings.worldSize > z) {
    return false;
  }
  return true;
}

function sendChunk(client, x, z) {
  if (settings.worldSize-1 < x*16 || -settings.worldSize-1 > x*16 || settings.worldSize-1 < z*16 || -settings.worldSize-1 > z*16) {
    console.log(x, z)
    return;
  }
  world.getColumn(x, z).then((chunk) => {
    console.log(x, z)
    client.write('map_chunk', {
      x: x,
      z: z,
      groundUp: true,
      bitMap: chunk.getMask(),
       chunkData: chunk.dump(),
    });
  });
}

const world = new World(generateChunk);

server.on('login', function (client) {
  client.player = {
    pos: new Vec3(settings.spawnX, settings.spawnY, settings.spawnZ),
    yaw: settings.spawnYaw,
    pitch: settings.spawnPitch,
    state: 0,
    health: 20.0,
    newPos: null,
    newLook: null,
    lastHit: 0,
    viewDistance: 5
  }

  console.log('+', client.username, client.id);

  client.write('login', {
    entityId: client.id,
    gamemode: 0,
    dimension: 0,
    difficulty: 3,
    maxPlayers: server.maxPlayers,
    levelType: 'default',
    reducedDebugInfo: false
  });

  for (var x=-(client.player.viewDistance/2);x<client.player.viewDistance/2;x++) {
    for (var z=-(client.player.viewDistance/2);z<client.player.viewDistance/2;z++) {
      //world.getColumn(x, z).then(console.log)
      sendChunk(client, x, z);
    }
  }

  client.write('position', {
    x: client.player.pos.x,
    y: client.player.pos.y,
    z: client.player.pos.z,
    yaw: client.player.yaw,
    pitch: client.player.pitch,
    flags: 0x00
  });

  broadcast('player_info', {
    action: 0,
    data: [{
      UUID: client.uuid,
      name: client.username,
      properties: [],
      gamemode: 0,
      ping: 0
    }]
  });
  broadcast('named_entity_spawn', {
    entityId: client.id,
    playerUUID: client.uuid,
    x: client.player.pos.x * 32,
    y: client.player.pos.y * 32,
    z: client.player.pos.z * 32,
    yaw: 0,
    pitch: 0,
    currentItem: 0,
    metadata: [
      { key: 0, value: 0, type: 0 },
      { key: 1, type: 1, value: 300 },
  //    { key: 2, type: 4, value: client.username },
      { key: 3, type: 0, value: 0 },
      { key: 4, type: 0, value: 0 },
      { key: 6, type: 3, value: 20 },
      { key: 7, type: 2, value: 0 },
      { key: 8, type: 0, value: 0 },
      { key: 9, type: 0, value: 0 },
      { key: 10, type: 0, value: 0 },
      { key: 16, type: 0, value: 0 },
      { key: 17, type: 3, value: 0 },
      { key: 18, type: 2, value: 0 }
    ]
  }, client.id);

  client.write('world_border', {
    action: 3,
    x: 0, z: 0,
    old_radius: settings.worldSize * 2,
    new_radius: settings.worldSize * 2,
    speed: 0,
    portalBoundary: settings.worldSize * 2,
    warning_time: 0,
    warning_blocks: 0
  });

  broadcast('chat', {
    message: JSON.stringify({text: `${client.username} has joined the game.`, color: 'yellow'}),
    position: 0
  });

  setInterval(function() {
    broadcast('player_info', {
      action: 3,
      data: [{
        UUID: client.uuid,
        displayName: JSON.stringify(generateNametag(client.player.health, client.username))
      }]
    });
    if (client.player.health < 5) {
      broadcast('animation', {
        entityId: client.id,
        animation: 1
      }, client.id);
    }
  }, 400);

  setInterval(function(){
    let newYaw, newPitch;
    let shouldRotate = false;
    if (client.player.newLook != null) {
      shouldRotate = true;
      newYaw = client.player.newLook[0];
      newPitch = client.player.newLook[1];
      client.player.yaw = newYaw;
      client.player.pitch = newPitch;
      client.player.newLook = null;
    }
    if (client.player.newPos != null) {
      if (!isInsideBorder(client.player.newPos.x, client.player.newPos.z)) {
        client.end("You're not allowed to go there!")
        return;
      }
      client.player.knownPos = client.player.knownPos === undefined ? client.player.pos : client.player.knownPos;
      const oldChunk = getChunkPos(client.player.knownPos.x, client.player.knownPos.z);
      const diff = client.player.newPos.minus(client.player.knownPos);
      if (diff.abs().x > 3 || diff.abs().y > 3 || diff.abs().z > 3) {
        broadcast('entity_teleport', {
          entityId: client.id,
          x: client.player.knownPos.x,
          y: client.player.knownPos.y,
          z: client.player.knownPos.z,
          yaw: convLook(client.player.yaw),
          pitch: convLook(client.player.pitch),
          onGround: client.player.onGround
        }, client.id, client);
      } else if (diff.distanceTo(new Vec3(0,0,0)) !== 0) {
        const delta = diff.scaled(32).floored();
        client.player.knownPos = client.player.knownPos.plus(delta.scaled(1 / 32))
        if (!shouldRotate) {
          broadcast('rel_entity_move', {
            entityId: client.id,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            onGround: client.player.onGround
          }, client.id, client);
        } else {
          broadcast('entity_move_look', {
            entityId: client.id,
            dX: delta.x,
            dY: delta.y,
            dZ: delta.z,
            yaw: convLook(newYaw),
            pitch: convLook(newPitch),
            onGround: client.player.onGround
          }, client.id, client);
        }
      }
      const newChunk = getChunkPos(client.player.newPos.x, client.player.newPos.z);
      const mod = newChunk.minus(oldChunk);
      console.log(oldChunk, newChunk)
      if (!mod.equals(new Vec3(0,0,0))) {
        let toLoad = [];
        if (mod.x > 0) {
          for (let z=newChunk.z-client.player.viewDistance/2;z<newChunk.z+client.player.viewDistance/2;z++) {
            toLoad.push(new Vec3(newChunk.x + 1, 0, z));
          }
        }
        if (mod.x < 0) {
          for (let z=newChunk.z-client.player.viewDistance/2;z<newChunk.z+client.player.viewDistance/2;z++) {
            toLoad.push(new Vec3(newChunk.x - 1, 0, z));
          }
        }
        if (mod.z > 0) {
          for (let x=newChunk.x-client.player.viewDistance/2;x<newChunk.x+client.player.viewDistance/2;x++) {
            toLoad.push(new Vec3(x, 0, newChunk.z + 1));
          }
        }
        if (mod.z < 0) {
          for (let x=newChunk.x-client.player.viewDistance/2;x<newChunk.x+client.player.viewDistance/2;x++) {
            toLoad.push(new Vec3(x, 0, newChunk.z - 1));
          }
        }
        if (toLoad.length > 0) {
          for (var i=0;i<toLoad.length;i++) {
            console.log(toLoad[i]);
            sendChunk(client, toLoad[i].x, toLoad[i].z);
          }
        }
      }
      client.player.pos = client.player.newPos;
      client.player.newPos = null;
    } else if (shouldRotate) {
      broadcast('entity_look', {
        entityId: client.id,
        yaw: convLook(newYaw),
        pitch: convLook(newPitch),
        onGround: client.player.onGround
      }, client.id, client);
    } else {
      broadcast('entity', {
        entityId: client.id
      }, client.id, client);
    }
    if (shouldRotate) {
      broadcast('entity_head_rotation', {
        entityId: client.id,
        headYaw: convLook(newYaw)
      }, client.id, client);
    }
  }, 20);

  client.on('packet', (data, meta) => {
    if (meta.name != "flying") console.log(client.username, meta, data);
    if (['position', 'position_look'].includes(meta.name)) {
      client.player.newPos = new Vec3(data.x, data.y, data.z);
      if (meta.name == 'position_look') {
        var yaw = data.yaw % 360;
        if (yaw < 0) yaw += 360;
        client.player.newLook = [ yaw, data.pitch ];
      }
      client.player.onGround = data.onGround;
    }
    if (meta.name == "look") {
      var yaw = data.yaw % 360;
      if (yaw < 0) yaw += 360;
      client.player.newLook = [ yaw, data.pitch ];
      client.player.onGround = data.onGround;
    }
    if (meta.name == "entity_action") {
      if (data.actionId == 0) client.player.state = 2;
      if (data.actionId == 1) client.player.state = 0;
      if (data.actionId == 3) {
        client.player.state = 8;
        client.player.sprintFirstHit = true;
      }
      if (data.actionId == 4) client.player.state = 0;
      console.log(client.player.state)
      broadcast('entity_metadata', {
        entityId: client.id,
        metadata: [
          { key: 0, type: 0, value: client.player.state }
        ]
      }, client.id);
    } else if (meta.name == "arm_animation") {
      broadcast('animation', {
        entityId: client.id,
        animation: 0
      }, client.id, client);
    } else if (meta.name == "chat") {
      broadcast('chat', {
        message: JSON.stringify({
          translate: 'chat.type.text',
          with: [ client.username, data.message ]
        }),
        position: 0,
        sender: client.username
      })
    } else if (meta.name == "block_dig" && data.status == 0) {
      client.write('block_change', {
        location: { x: data.location.x, y: data.location.y, z: data.location.z },
        type: world.sync.getBlockType(new Vec3(data.location)).id << 4
      });
    } else if (meta.name == "block_place" && data.status == 0) {
      client.write('block_change', {
        location: { x: data.location.x, y: data.location.y, z: data.location.z },
        type: world.sync.getBlockType(new Vec3(data.location)).id << 4
      });
    } else if (meta.name == "use_entity" && data.mouse == 1) {
      const target = server.clients[data.target];
      if (target != undefined && target.player.lastHit < Date.now()) {
        target.player.lastHit = Date.now() + settings.hitDelay
        const isCrit = client.player.onGround;
        broadcast('animation', {
          entityId: target.id,
          animation: 1
        }, undefined, client);
        if (isCrit) {
          broadcast('animation', {
            entityId: target.id,
            animation: 4
          }, undefined, client);
        }
        const kbDef = settings.knockback.default;
        const kbSprint = settings.knockback.sprintFirstHit;
        const moreKb = client.player.sprintFirstHit ? true : false
        client.player.sprintFirstHit = false;

        let vx, vz
        const yawPrepX = client.player.yaw < 90 ? 360 - (90 - client.player.yaw) : client.player.yaw - 90
        if (yawPrepX > 180) vx = (180 - (yawPrepX - 180)) / 90 - 1
        else vx = yawPrepX / 90 - 1

        const yawPrepZ = client.player.yaw < 180 ? 360 - (180 - client.player.yaw) : client.player.yaw - 180
        if (yawPrepZ > 180) vz = (180 - (yawPrepZ - 180)) / 90 - 1
        else vz = yawPrepZ / 90 - 1

        target.write('entity_velocity', {
          entityId: target.id,
          velocityX: vx * (moreKb ? kbSprint[0] : kbDef[0]),
          velocityY: (moreKb ? kbSprint[1] : kbDef[1]),
          velocityZ: vz * (moreKb ? kbSprint[2] : kbDef[2])
        });
        if (target.player.health - 0.5 > 0) {
          target.player.health -= 0.5
          target.write('update_health', {
            health: target.player.health,
            food: 20,
            foodSaturation: 20
          });
        }
      }
    } else if (meta.name == "held_item_slot") {
      client.player.selSlot = data.slotId;
    } else if (meta.name == "settings") {
      client.player.viewDistance = data.viewDistance;
    }
  });

  function removeClient() {
    console.log('-', client.username)
    broadcast('player_info', {
      action: 4,
      data: [{
        UUID: client.uuid
      }]
    }, client.id);
    broadcast('entity_destroy', {
      entityIds: [client.id]
    }, client.id);
  }

  client.on('end', () => {
    removeClient();
    broadcast('chat', {
      message: JSON.stringify({text: `${client.username} has left the game.`, color: 'yellow'}),
      position: 0
    });
  });
//  client.on('error', (err) => { removeClient() });
  
  let loopClient, pos
  for (const clientId in server.clients) {
    if (clientId === undefined) continue;
    if (clientId == client.id) continue;
    loopClient = server.clients[clientId];
    console.log(client.id, clientId, loopClient.username)
    client.write('player_info', {
      action: 0,
      data: [{
        UUID: loopClient.uuid,
        name: loopClient.username,
        properties: [],
        gamemode: 0,
        ping: 0
      }]
    });
    pos = loopClient.player.pos.scaled(32).floored();
    client.write('named_entity_spawn', {
      entityId: loopClient.id,
      playerUUID: loopClient.uuid,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: convLook(loopClient.player.yaw),
      pitch: convLook(loopClient.player.pitch),
      currentItem: 0,
      metadata: [
        { key: 0, value: 0, type: 0 },
        { key: 1, type: 1, value: 300 },
        { key: 2, type: 4, value: loopClient.username },
        { key: 3, type: 0, value: 0 },
        { key: 4, type: 0, value: 0 },
        { key: 6, type: 3, value: 20 },
        { key: 7, type: 2, value: 0 },
        { key: 8, type: 0, value: 0 },
        { key: 9, type: 0, value: 0 },
        { key: 10, type: 0, value: 0 },
        { key: 16, type: 0, value: 0 },
        { key: 17, type: 3, value: 0 },
        { key: 18, type: 2, value: 0 }
      ]
    });
  }
})

function refreshInventory(client) {
  // TODO
}

function broadcast(name, data, exclude, source) {
  let viewDistance
  if (source != undefined) {
    viewDistance = source.player.viewDistance;
  }
  for (const clientId in server.clients) {
    if (clientId === undefined) continue
    if (exclude != undefined && exclude == clientId) continue
    if (viewDistance != undefined && server.clients[clientId].player != undefined && !isVisible(viewDistance, source.player.pos, server.clients[clientId].player.pos)) continue;
    server.clients[clientId].write(name, data);
  }
}

function convLook(f) {
  let b = Math.floor((f % 360) * 256 / 360);
  if (b < -128) b += 256;
  else if (b > 127) b -= 256;
  return b;
}

function generateNametag(h, n) {
  const step = 20 / n.length;
  var json = {
    text: n.slice(0, h / step), color: 'red', extra: 
    [{text: n.slice(h / step), color: 'white'}]
  };
  return json;
}

function getChunkPos(x, z) {
  return new Vec3(Math.floor(x / 16), 0, Math.floor(z / 16));
}

function isVisible(viewDistance, source, target) {
  if (Math.abs(target.x-source.x) > viewDistance*16) {
    return false;
  }
  if (Math.abs(target.z-source.z) > viewDistance*16) {
    return false;
  }
  return true;
}