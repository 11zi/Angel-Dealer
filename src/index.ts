import { Context, Schema, Logger, sleep } from 'koishi';
import { StockSession } from 'koishi-plugin-adapter-iirose';
import { it } from 'node:test';

export const name = 'buckshot-roulette'

export interface Config {
  commandText : string;
  rule_1 : boolean;
  rule_2 : boolean;
  rule_3 : boolean;
}

export const Config: Schema<Config> = Schema.object({
  commandText: Schema.string().description('该插件的命令前缀').default('恶魔轮盘赌'),
  rule_1: Schema.boolean().description('手铐打自己空枪时也消耗手铐').default(false),
  rule_2: Schema.boolean().description('重装填时是否强制切换到对方的回合').default(false),
  rule_3: Schema.boolean().description('空弹是否取消霰弹枪截短的状态').default(true),
})

export function apply(ctx: Context, cfg: Config) {
  const logger = new Logger('恶魔轮盘赌')
  logger.info('插件 已启用')

  var gameStatus,isTurn

  ctx.command(`${cfg.commandText} <command1:string> [...command2:string]`).action((_, command1, ...command2) => {
    // if (_.session.platform != "iirose") { return; }
    var message = ''

    if(gameStatus != null) isTurn = (gameStatus.pCurrent == _.session.username)
    switch(command1) {
      case 'help':
        message = `${cfg.commandText} help\n坐庄->加入->查看->接管\n对方/自己/道具(镣铐,放大镜,手锯,香烟,饮料)`
        break;
      case '坐庄':
        message = ` [*${_.session.username}*]  开启一场新的轮盘赌，`
        gameStatus = new BuckshotRoulette(cfg)
        gameStatus.addDealer(_.session.username)
        break;
      case '加入':
        if(gameStatus!=null && gameStatus.addPlayer(_.session.username)) {
          message = ` [*${_.session.username}*]  加入了本场轮盘赌，`
          message += '\n'
          message += gameStatus.getInformationText()
        }else{
          message = ` [*${_.session.username}*]  你不准加入（`
        }
        break;
      case '结束本场':
        if(gameStatus==null) 
          message = ` [*${_.session.username}*]  当前没有正在进行的对局`
        else{
          if(gameStatus.endAll(_.session.username))
            message = ` [*${_.session.username}*]  结束了对局`
          else
            message = ` [*${_.session.username}*]  您不是对局内的玩家，不能终结比赛`
        }
        break;
      case '接管':
        message = `${_.session.username}*]  这个功能还没写好`
        // if(gameStatus==null) 
        //   message = ` [*${_.session.username}*]  当前没有正在进行的对局`
        // else{
        //   if(gameStatus.changePlayer())
        //     message = ` [*${_.session.username}*]  接管了当前轮值的角色`
        //   else
        //     message = ` [*${_.session.username}*]  接管失败，总之就是没有成功`
        // }
        break;
      case '查看':
        if(gameStatus==null) 
          message = ` [*${_.session.username}*]  当前没有正在进行的对局`
        else{
          message = gameStatus.getInformationText()
        }
        break;
      case '道具':
        if(!isTurn) {
          message = ` [*${_.session.username}*]  你不准用道具（\n`
          break;
        }
        var _useItem = gameStatus.useItem(command2)
        if(_useItem != false) {
          message = _useItem
        }else
          message = ` [*${_.session.username}*]  您似乎并没有这个道具 ${command2}\n`
        break;
      case '对方':
        if(!isTurn) {
          message = ` [*${_.session.username}*] 你不准开枪（\n`
          break;
      }
        message = ` [*${_.session.username}*]  瞄向对方，扣动了扳机\n`
        message += gameStatus.useGun(false)
        break;
      case '自己':
        if(!isTurn) {
          message = ` [*${_.session.username}*]  你不准开枪（\n`
          break;
      }
        message = ` [*${_.session.username}*]  瞄向自己，扣动了扳机\n`
        message += gameStatus.useGun(true)
        break;
      default:
        message = `未知的命令：${command1}`
    }
    // logger.info(message)
    _.session.send(message)
  })
  
}

const operate = {
  'blanks' : '咯嗒。空弹\n',
  'liveRound' : '砰！\n',
  'careful' : 'CAREFUL, NOW ...\n',
  'see_blanks' : '有趣...🈳\n',
  'see_liveRound' : '非常有趣...💥\n',
}
const prop = ['镣铐','放大镜','手锯','香烟','饮料']
const emoji = {
  'full' : '💥',
  'blank' : '🈳',
  'life' : '⚡',
  'ban' : '🚫',
  'saw' : '[截短]'
}

/**
 * 轮盘赌实例
 */
class BuckshotRoulette{
  /** @description 恶魔/庄家名称 */
  private dealer;
  /** @description 恶魔/庄家生命值 */
  private dealerLife;
  /** @description 玩家名称 */
  private player;
  /** @description 玩家生命值 */
  private playerLife;
  /** @description 恶魔/庄家物品栏 */
  private dealerItems;
  /** @description 玩家物品栏 */
  private playerItems;
  /** @description 枪内子弹，数组 */
  private GUN;
  /** @description 是否截短（伤害加倍） */
  private isShortened;
  /** @description 对方是否有镣铐 */
  private isLocked;
  /** @description 本回合是否已经使用过道具 */
  private isItemUsed
  private static _resetItemUsed = { 'shackle':false , 'scope':false, 'handSaw':false, 'cigarette':false, 'drink':false };
  /** @description 游戏是否在进行中 */
  private ongoing;
  /** @description 当前轮值的玩家 */
  public pCurrent;
  /** @description 手铐打自己空枪是否消耗手铐 */
  private rule_1
  /** @description 弹夹打空是否强制切换到对方的回合 */
  private rule_2
  /** @description 空弹是否取消截短状态 */
  private rule_3
  
  constructor(cfg:Config = null) {
    this.ongoing = false
    this.rule_1 = cfg.rule_1 || false
    this.rule_2 = cfg.rule_2 || false
    this.rule_3 = cfg.rule_3 || true
    this.isShortened = false
    this.isLocked = false
    this.isItemUsed = BuckshotRoulette._resetItemUsed
    this.GUN = []
    this.dealerItems = []
    this.playerItems = []
  }

  addDealer(name) {
    if(!this.dealer) {
      this.dealer = name
      return true
    }else{return false}
  }
  addPlayer(name) {
    if((this.dealer) && !(this.player) && (this.dealer != name)) {
      this.player = name
      return this.start()
    }else{return false}
  }
  changeDealer(name) {
    if(name!=this.dealer && name!=this.player) {
      this.dealer = name
      this.pCurrent = this.dealer
      return true
    }else{return false}
  }
  changePlayer(name) {
    if(name!=this.player&&name!=this.dealer) {
      this.player = name
      this.pCurrent = this.dealer
      return true
    }else{return false}
  }

  // 初始化游戏
  start() {
    if(this.dealer&&this.player&&!this.ongoing) {
      // 子弹上膛
      this.reloading()
      // 玩家血量
      this.playerLife = Math.floor(Math.random() * 3) + 2
      this.dealerLife = this.playerLife
      // 随机道具(不继承至下一轮)
      var _item_num = Math.floor(Math.random() * 8)
      this.takePropOut(_item_num)

      this.pCurrent = this.player

      this.ongoing = true
      return true
    }else {return false}
  }

  /**
   * 古希腊掌管自杀的神
   * @param isSelf 是否朝自己开枪
   * @returns 对局信息，或者false
   */
  useGun(isSelf) {
    var msg = ''
    var isNotEnd = true
    if(!(typeof isSelf === "boolean")) return false

    var shoot = this.GUN.pop()
    if(shoot == emoji.full) {
      var dmg = (this.isShortened)?2:1
      // 两次异或
      var isDealerGetHurt = (((this.pCurrent == this.dealer)?true:false) == isSelf)?true:false
      if(isDealerGetHurt) this.dealerLife -= dmg
      else this.playerLife -= dmg
      if(this.isLocked) this.isLocked = false
      else this.switchTurn()
      this.isShortened = false
      msg += operate.liveRound
      msg += this.checkEnd()
    }else if(shoot == emoji.blank) {
      // 打对方
      if(!isSelf) {
        if(this.isLocked) {
          this.isLocked = false
        }else this.switchTurn()
      // 打自己
      }else if(this.isLocked) {
        // 手铐打自己空枪并不消耗手铐，但如果设置为消耗手铐是否更有意思呢
        if(this.rule_1)
          this.isLocked = false
        if(this.rule_3)
         this.isShortened = false
      }
      msg += operate.blanks
    }

    // 检查空弹
    if(this.GUN == 0) {
      if(this.rule_2) {
        this.switchTurn()
      }
      this.reloading()
    }
    if(this.ongoing)
      msg += this.getInformationText()
    return msg
  }

  /**
   * 使用道具<br/>
   * ['镣铐','放大镜','手锯','香烟','饮料']
   * @param str 道具名 
   * @returns bool 是否成功使用
   */
  public useItem(args) {
    var message = ''
    if(typeof args != 'string') {
      for (const i in args) {
        if (Object.prototype.hasOwnProperty.call(args, i)) {
          const name = args[i];
          var textReturn = this._useItem(name)
          if(textReturn != false) {
            message += textReturn
          }
          else{
            message += `${args[i]} 是什蘑...？\n`
          }
        }
      }
    }
    else{
      var msg = this._useItem(args)
      if(msg != false) {
        message += textReturn
      }
      else{
        message += `${args} 是什蘑...？\n`
      }
    }
    message += '\n'
    message += this.getInformationText()
    return message
  }
  private _useItem(str) {
    var msgReturn = `${this.pCurrent}使用了 ${str}\n`
    // '镣铐','放大镜','手锯','香烟','饮料'
    switch(str) {
      case (prop[0]):
        var _if_0 = this.shackle()
        if(_if_0 != false && (typeof _if_0 != 'boolean')){ msgReturn += _if_0 }
        break;
      case (prop[1]):
        var _if_1 = this.scope()
        if(_if_1 != false)
        msgReturn += _if_1
        break;
      case (prop[2]):
        var _if_2 = this.handSaw()
        if(_if_2 != false) {
          msgReturn += '打算整个狠活..\n'
        }
        break;
      case (prop[3]):
        this.cigarette()
        break;
      case (prop[4]):
        var _if_4 = this.drink()
        if(_if_4 != false) {
          msgReturn += `拿出了${_if_4}`
        }
        break;
      default:
        return false
    }
    return msgReturn
  }

  /**
   * @returns 字符串：对局信息
   */
  getInformationText() {
    var msg = ''
    var full=0,blank=0
    for (const i in this.GUN) {
      if (Object.prototype.hasOwnProperty.call(this.GUN, i)) {
        const element = this.GUN[i];
        if(element == emoji.full) full += 1
        else if(element == emoji.blank) blank += 1
      }
    }
    msg+=emoji.full.repeat(full)
    msg+=emoji.blank.repeat(blank)
    msg+='\n'

    if(this.pCurrent == this.dealer) {
      msg += '→ ';
      if(this.isShortened) msg += emoji.saw;
    }
    else{
      if(this.isLocked) msg += emoji.ban;
    }
    msg += this.dealer
    msg += '：'
    msg += emoji.life.repeat(this.dealerLife) + '\n  道具：'
    if(this.dealerItems != 0)
      for (const i in this.dealerItems) {
        if (Object.prototype.hasOwnProperty.call(this.dealerItems, i)) {
          const item = this.dealerItems[i];
          msg+=item+'，'
        }
      }
    msg+='\n'
    
    if(this.pCurrent == this.player) {
      msg += '→ ';
      if(this.isShortened) msg += emoji.saw;
    }
    else{
      if(this.isLocked) msg += emoji.ban;
    }
    msg += this.player
    msg += '：'
    msg += emoji.life.repeat(this.playerLife) + '\n  道具：'
    if(this.playerItems != 0)
      for (const i in this.playerItems) {
        if (Object.prototype.hasOwnProperty.call(this.playerItems, i)) {
          const item = this.playerItems[i];
          msg+=item+'，'
        }
      }

    return msg
  }

  private switchTurn() {
    this.pCurrent = (this.pCurrent == this.dealer)?this.player:this.dealer
  }

  private shackle() {
    if (this.pCurrent == this.dealer) {
      if (this.removeDealerItem(0)) {
        this.isLocked = true
        this.isItemUsed[0] = true
        return true
      }
    }else{
      if (this.removePlayerItem(0)) {
        this.isLocked = true
        this.isItemUsed[0] = true
        return true
      }
    }
    return false
  }
  private scope() {
    var result = (this.GUN[this.GUN.length - 1] == emoji.full)?operate.see_liveRound:operate.see_blanks
    if (this.pCurrent == this.dealer) {
      if (this.removeDealerItem(1)) {
        this.isItemUsed[1] = true
        return result
      }
    }else{
      if (this.removePlayerItem(1)) {
        this.isItemUsed[1] = true
        return result
      }
    }
    return false
  }
  private handSaw() {
    if (this.pCurrent == this.dealer) {
      if (this.removeDealerItem(2)) {
        this.isShortened = true
        this.isItemUsed[2] = true
        return true
      }
    }else{
      if (this.removePlayerItem(2)) {
        this.isShortened = true
        this.isItemUsed[2] = true
        return true
      }
    }
    return false
  }
  private cigarette() {
    if (this.pCurrent == this.dealer) {
      if (this.removeDealerItem(3)) {
        this.dealerLife += 1
        this.isItemUsed[3] = true
        return true
      }
    }else{
      if (this.removePlayerItem(3)) {
        this.playerLife += 1
        this.isItemUsed[3] = true
        return true
      }
    }
    return false
  }
  private drink() {
    if (this.pCurrent == this.dealer) {
      if (this.removeDealerItem(4)) {
        this.isItemUsed[4] = true
        return this.GUN.pop()
      }
    }else{
      if (this.removePlayerItem(4)) {
        this.isItemUsed[4] = true
        return this.GUN.pop()
      }
    }
    return false
  }

  private removePlayerItem(itemId) {
    for (const i in this.playerItems) {
      if (Object.prototype.hasOwnProperty.call(this.playerItems, i)) {
        const item = this.playerItems[i];
        if (item == prop[itemId]) {
          this.playerItems.splice(i,1)
          return true
        }
      }
    }
    return false
  }
  private removeDealerItem(itemId) {
    for (const i in this.dealerItems) {
      if (Object.prototype.hasOwnProperty.call(this.dealerItems, i)) {
        const item = this.dealerItems[i];
        if (item == prop[itemId]) {
          this.dealerItems.splice(i,1)
          return true
        }
      }
    }
    return false
  }

  /**
   * 重新上膛
   */
  private reloading() {
    var full = 1 + Math.floor(Math.random() * 3)
    var blank = 1 + Math.floor(Math.random() * 3)
    while (full + blank > 0) {
      if(Math.random()>0.5 && full > 0) {
        this.GUN.push(emoji.full)
        full -= 1
      }else if(blank > 0) {
        this.GUN.push(emoji.blank)
        blank -= 1
      }
    }
    this.takePropOut(4)
  }

  private takePropOut(amount) {
    for(var i = 0;i < amount;i++) {
      if(Math.random() > 0.5 ) { continue; }
      if(Math.random() > 0.55) {
        this.dealerItems.push(prop[Math.floor(Math.random()*5)])
      }else{
        this.playerItems.push(prop[Math.floor(Math.random()*5)])
      }
    }
  }

  checkEnd() {
    if(this.dealerLife<=0) {
      this.ongoing = false
      return `${ this.dealer } 失败了。\n${this.player} 获胜！\n`
    }else if(this.playerLife<=0) {
      this.ongoing = false
      return `${ this.player } 失败了。\n${this.dealer} 获胜！\n`
    }
    return ''
  }

  endAll(name) {
    if(name == this.dealer || name == this.player) {
      return ` [*${name}*]  提前终止了本场对局`
    } else return false
  }
}