import { isUsernameValid } from "../handlers/validation";
import { updateAuthEmail } from "../handlers/auth";
import { checkAndUpdatePb } from "../handlers/pb";
import db from "../init/db";
import MonkeyError from "../handlers/error";
import { escapeRegExp } from "../handlers/misc";
import { ObjectId } from "mongodb";
class UsersDAO {
  static async addUser(name, email, uid) {
    const user = await db.collection("users").findOne({ uid });
    if (user)
      throw new MonkeyError(400, "User document already exists", "addUser");
    return await db
      .collection("users")
      .insertOne({ name, email, uid, addedAt: Date.now() });
  }

  static async deleteUser(uid) {
    return await db.collection("users").deleteOne({ uid });
  }

  static async updateName(uid, name) {
    if (!this.isNameAvailable(name))
      throw new MonkeyError(409, "Username already taken", name);
    let user = await db.collection("users").findOne({ uid });
    if (
      Date.now() - user.lastNameChange < 2592000000 &&
      isUsernameValid(user.name)
    ) {
      throw new MonkeyError(409, "You can change your name once every 30 days");
    }
    return await db
      .collection("users")
      .updateOne({ uid }, { $set: { name, lastNameChange: Date.now() } });
  }

  static async clearPb(uid) {
    return await db
      .collection("users")
      .updateOne({ uid }, { $set: { personalBests: {}, lbPersonalBests: {} } });
  }

  static async isNameAvailable(name) {
    const nameDoc = await db
      .collection("users")
      .findOne({ name: new RegExp(`^${escapeRegExp(name)}$`, "i") });
    if (nameDoc) {
      return false;
    } else {
      return true;
    }
  }

  static async updateQuoteRatings(uid, quoteRatings) {
    const user = await db.collection("users").findOne({ uid });
    if (!user)
      throw new MonkeyError(404, "User not found", "updateQuoteRatings");
    await db.collection("users").updateOne({ uid }, { $set: { quoteRatings } });
    return true;
  }

  static async updateEmail(uid, email) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "update email");
    await updateAuthEmail(uid, email);
    await db.collection("users").updateOne({ uid }, { $set: { email } });
    return true;
  }

  static async getUser(uid) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "get user");
    return user;
  }

  static async getUserByDiscordId(discordId) {
    const user = await db.collection("users").findOne({ discordId });
    if (!user)
      throw new MonkeyError(404, "User not found", "get user by discord id");
    return user;
  }

  static async addTag(uid, name) {
    let _id = new ObjectId();
    await db
      .collection("users")
      .updateOne({ uid }, { $push: { tags: { _id, name } } });
    return {
      _id,
      name,
    };
  }

  static async getTags(uid) {
    const user = await db.collection("users").findOne({ uid });
    // if (!user) throw new MonkeyError(404, "User not found", "get tags");
    return user?.tags ?? [];
  }

  static async editTag(uid, _id, name) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "edit tag");
    if (
      user.tags === undefined ||
      user.tags.filter((t) => t._id == _id).length === 0
    )
      throw new MonkeyError(404, "Tag not found");
    return await db.collection("users").updateOne(
      {
        uid: uid,
        "tags._id": new ObjectId(_id),
      },
      { $set: { "tags.$.name": name } }
    );
  }

  static async removeTag(uid, _id) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "remove tag");
    if (
      user.tags === undefined ||
      user.tags.filter((t) => t._id == _id).length === 0
    )
      throw new MonkeyError(404, "Tag not found");
    return await db.collection("users").updateOne(
      {
        uid: uid,
        "tags._id": new ObjectId(_id),
      },
      { $pull: { tags: { _id: new ObjectId(_id) } } }
    );
  }

  static async removeTagPb(uid, _id) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "remove tag pb");
    if (
      user.tags === undefined ||
      user.tags.filter((t) => t._id == _id).length === 0
    )
      throw new MonkeyError(404, "Tag not found");
    return await db.collection("users").updateOne(
      {
        uid: uid,
        "tags._id": new ObjectId(_id),
      },
      { $set: { "tags.$.personalBests": {} } }
    );
  }

  static async updateLbMemory(uid, mode, mode2, language, rank) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "update lb memory");
    if (user.lbMemory === undefined) user.lbMemory = {};
    if (user.lbMemory[mode] === undefined) user.lbMemory[mode] = {};
    if (user.lbMemory[mode][mode2] === undefined)
      user.lbMemory[mode][mode2] = {};
    user.lbMemory[mode][mode2][language] = rank;
    return await db.collection("users").updateOne(
      { uid },
      {
        $set: { lbMemory: user.lbMemory },
      }
    );
  }

  static async checkIfPb(uid, result) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "check if pb");

    const {
      mode,
      mode2,
      acc,
      consistency,
      difficulty,
      lazyMode,
      language,
      punctuation,
      rawWpm,
      wpm,
      funbox,
    } = result;

    if (funbox !== "none" && funbox !== "plus_one" && funbox !== "plus_two") {
      return false;
    }

    if (mode === "quote") {
      return false;
    }

    let lbpb = user.lbPersonalBests;
    if (!lbpb) lbpb = {};

    let pb = checkAndUpdatePb(
      user.personalBests,
      lbpb,
      mode,
      mode2,
      acc,
      consistency,
      difficulty,
      lazyMode,
      language,
      punctuation,
      rawWpm,
      wpm
    );

    if (pb.isPb) {
      await db
        .collection("users")
        .updateOne({ uid }, { $set: { personalBests: pb.obj } });
      if (pb.lbObj) {
        await db
          .collection("users")
          .updateOne({ uid }, { $set: { lbPersonalBests: pb.lbObj } });
      }
      return true;
    } else {
      return false;
    }
  }

  static async checkIfTagPb(uid, result) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "check if tag pb");

    if (user.tags === undefined || user.tags.length === 0) {
      return [];
    }

    const {
      mode,
      mode2,
      acc,
      consistency,
      difficulty,
      lazyMode,
      language,
      punctuation,
      rawWpm,
      wpm,
      tags,
      funbox,
    } = result;

    if (funbox !== "none" && funbox !== "plus_one" && funbox !== "plus_two") {
      return [];
    }

    if (mode === "quote") {
      return [];
    }

    let tagsToCheck = [];
    user.tags.forEach((tag) => {
      tags.forEach((resultTag) => {
        if (resultTag == tag._id) {
          tagsToCheck.push(tag);
        }
      });
    });

    let ret = [];

    tagsToCheck.forEach(async (tag) => {
      let tagpb = checkAndUpdatePb(
        tag.personalBests,
        undefined,
        mode,
        mode2,
        acc,
        consistency,
        difficulty,
        lazyMode,
        language,
        punctuation,
        rawWpm,
        wpm
      );
      if (tagpb.isPb) {
        ret.push(tag._id);
        await db
          .collection("users")
          .updateOne(
            { uid, "tags._id": new ObjectId(tag._id) },
            { $set: { "tags.$.personalBests": tagpb.obj } }
          );
      }
    });

    return ret;
  }

  static async resetPb(uid) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "reset pb");
    return await db
      .collection("users")
      .updateOne({ uid }, { $set: { personalBests: {} } });
  }

  static async updateTypingStats(uid, restartCount, timeTyping) {
    const user = await db.collection("users").findOne({ uid });
    if (!user)
      throw new MonkeyError(404, "User not found", "update typing stats");

    return await db.collection("users").updateOne(
      { uid },
      {
        $inc: {
          startedTests: restartCount + 1,
          completedTests: 1,
          timeTyping,
        },
      }
    );
  }

  static async linkDiscord(uid, discordId) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "link discord");
    return await db
      .collection("users")
      .updateOne({ uid }, { $set: { discordId } });
  }

  static async unlinkDiscord(uid) {
    const user = await db.collection("users").findOne({ uid });
    if (!user) throw new MonkeyError(404, "User not found", "unlink discord");
    return await db
      .collection("users")
      .updateOne({ uid }, { $set: { discordId: null } });
  }

  static async incrementBananas(uid, wpm) {
    const user = await db.collection("users").findOne({ uid });
    if (!user)
      throw new MonkeyError(404, "User not found", "increment bananas");

    let best60;
    try {
      best60 = Math.max(...user.personalBests.time[60].map((best) => best.wpm));
    } catch (e) {
      best60 = undefined;
    }

    if (best60 === undefined || wpm >= best60 - best60 * 0.25) {
      //increment when no record found or wpm is within 25% of the record
      return await db
        .collection("users")
        .updateOne({ uid }, { $inc: { bananas: 1 } });
    } else {
      return null;
    }
  }

  static async setApeKeys(uid, apeKeys) {
    await db.collection("users").updateOne({ uid }, { $set: { apeKeys } });
  }
}

export default UsersDAO;
