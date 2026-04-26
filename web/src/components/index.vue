<template>
  <el-upload
    class="avatar-uploader"
    action="#"
    accept="image/jpeg,image/png,image/jpg"
    :auto-upload="false"
    :show-file-list="false"
    :on-change="handleUpload"
  >
    <img v-if="imageUrl" :src="imageUrl" class="avatar" />
    <el-icon v-else class="avatar-uploader-icon">
      <Plus />
    </el-icon>
  </el-upload>
</template>

<script lang="ts" setup>
import { ref, watch, onMounted } from "vue"
import { Plus } from "@element-plus/icons-vue"
import { Jimp } from "jimp"

import { ElMessage, UploadProps } from "element-plus"
import { Image } from "@/api/image/types/image"
import { updateImage } from "@/api/image"
import { imageManager } from "@/utils/image/image_manager"

// 定义 props 和 emits
const props = defineProps<{
  game: string
  type: string
  id: number | undefined
  img: string | undefined
}>()
const emits = defineEmits(["update:img"])

// 使用 props 中的 modelValue 作为初始值
const imageUrl = ref(props.img)

// 在组件挂载时尝试从IndexDB获取图片
onMounted(async () => {
  if (props.id !== undefined) {
    try {
      const uri = `${props.game}_${props.type}_${props.id}`
      const imageData = await imageManager.getImageByUri(uri)
      console.log(imageData)
      if (imageData) {
        imageUrl.value = imageData
        // 触发 update:img 事件，更新父组件的值
        emits("update:img", imageUrl.value)
      }
    } catch (error) {
      console.error("从IndexDB获取图片失败:", error)
    }
  }
})

// 监听 props.img 的变化
watch(
  () => props.img,
  (newVal) => {
    imageUrl.value = newVal
  }
)

const handleUpload: UploadProps["onChange"] = (uploadFile) => {
  const file = uploadFile.raw!
  const reader = new FileReader()
  console.log(reader)
  reader.onload = async (e) => {
    console.log(e)
    console.log(e.target)
    console.log(e.target?.result)
    if (e.target?.result) {
      console.log("okk")
      const image = await Jimp.read(e.target.result as ArrayBuffer)
      // 裁切成正方形
      const height = image.height
      const width = image.width
      if (height > width) {
        image.crop({ x: 0, y: 0, h: width, w: width })
      } else {
        image.crop({ x: 0, y: 0, h: height, w: height })
      }
      // 调整大小为64*64
      image.resize({ w: 64, h: 64 })
      const base64 = await image.getBase64("image/jpeg")
      imageUrl.value = base64
      // 触发 update:model-value 事件，更新父组件的 v-model 值
      emits("update:img", imageUrl.value)
      console.log("uri")
      if (props.id !== undefined) {
        const api_uri = `${props.type}_${props.id}`
        const uri = `${props.game}_${props.type}_${props.id}`
        const imageData: Image = {
          uri: api_uri,
          image: base64,
          createTime: undefined,
          updateTime: undefined
        }
        try {
          // 更新到服务器
          const result = await updateImage(imageData)
          console.log("图片更新成功", result)

          // 同步更新到IndexDB
          const now = new Date().toISOString()
          await imageManager.batchInsert([
            {
              uri: uri,
              image: base64,
              create_time: now,
              update_time: now
            }
          ])
          console.log("图片已同步到IndexDB")
        } catch (error) {
          console.error("图片更新失败", error)
        }
      } else {
        ElMessage.error("请创建完后再更新图片")
      }
    }
  }
  // 监听文件读取错误事件
  reader.onerror = (error) => {
    console.error("文件读取错误:", error)
  }
  reader.readAsArrayBuffer(file)
}
</script>

<style scoped>
.avatar-uploader .avatar {
  width: 178px;
  height: 178px;
  display: block;
}
</style>

<style>
.avatar-uploader .el-upload {
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: var(--el-transition-duration-fast);
}

.avatar-uploader .el-upload:hover {
  border-color: var(--el-color-primary);
}

.el-icon.avatar-uploader-icon {
  font-size: 28px;
  color: #8c939d;
  width: 178px;
  height: 178px;
  text-align: center;
}
</style>
