const state = require('./state');
const utils = require('./utils');
const shapesModule = require('./shapes');
const { getStroke } = require('perfect-freehand');

let device = null;
let context = null;
let canvasFormat = null;
let pipeline = null;
let strokePipeline = null;
let uniformBuffer = null;
let uniformBindGroup = null;
let depthTexture = null;

let isInitialized = false;
let initPromise = null;

const shaderCode = `
struct Uniforms {
    resolution: vec2<f32>,
    cameraPos: vec2<f32>,
    cameraZoom: f32,
    padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>
) -> VertexOutput {
    var output: VertexOutput;
    
    let worldPos = (position - uniforms.cameraPos) * uniforms.cameraZoom;
    let clipPos = vec2<f32>(
        worldPos.x / uniforms.resolution.x * 2.0 - 1.0,
        1.0 - worldPos.y / uniforms.resolution.y * 2.0
    );
    
    output.position = vec4<f32>(clipPos, 0.0, 1.0);
    output.color = color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
`;

async function initWebGPU(canvas) {
    if (isInitialized) return true;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        try {
            if (!navigator.gpu) {
                console.warn('[WebGPU] WebGPU not supported, falling back to Canvas2D');
                return false;
            }
            
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('[WebGPU] No GPU adapter found');
                return false;
            }
            
            device = await adapter.requestDevice();
            context = canvas.getContext('webgpu');
            
            if (!context) {
                console.warn('[WebGPU] Could not get WebGPU context');
                return false;
            }
            
            const dpr = window.devicePixelRatio || 1;
            canvasFormat = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device: device,
                format: canvasFormat,
                alphaMode: 'premultiplied',
                size: {
                    width: Math.floor(canvas.clientWidth * dpr),
                    height: Math.floor(canvas.clientHeight * dpr)
                }
            });
            
            const shaderModule = device.createShaderModule({
                code: shaderCode
            });
            
            pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                    buffers: [{
                        arrayStride: 8,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2'
                        }]
                    }, {
                        arrayStride: 16,
                        attributes: [{
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x4'
                        }]
                    }]
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{
                        format: canvasFormat,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: {
                    topology: 'triangle-list',
                }
            });
            
            uniformBuffer = device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            
            uniformBindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{
                    binding: 0,
                    resource: { buffer: uniformBuffer }
                }]
            });
            
            isInitialized = true;
            console.log('[WebGPU] Initialized successfully');
            return true;
        } catch (e) {
            console.error('[WebGPU] Initialization failed:', e);
            return false;
        }
    })();
    
    return initPromise;
}

function createVertexBuffer(points, color) {
    const vertexCount = points.length;
    const positionData = new Float32Array(vertexCount * 2);
    const colorData = new Float32Array(vertexCount * 4);
    
    for (let i = 0; i < vertexCount; i++) {
        positionData[i * 2] = points[i][0];
        positionData[i * 2 + 1] = points[i][1];
        
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        const a = 1.0;
        
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = a;
    }
    
    const positionBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = device.createBuffer({
        size: colorData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    return { positionBuffer, colorBuffer, vertexCount };
}

function triangulateStroke(outlinePoints) {
    const triangles = [];
    const n = outlinePoints.length;
    
    if (n < 3) return triangles;
    
    for (let i = 1; i < n - 1; i++) {
        triangles.push(
            outlinePoints[0][0], outlinePoints[0][1],
            outlinePoints[i][0], outlinePoints[i][1],
            outlinePoints[i + 1][0], outlinePoints[i + 1][1]
        );
    }
    
    return triangles;
}

function renderStrokeWebGPU(stroke, camera) {
    if (!device || !stroke.points || stroke.points.length < 2) return null;
    
    const { points, color, size, taper } = stroke;
    
    const outlinePoints = getStroke(points, {
        size: taper ? size : Math.max(1, size - 1),
        thinning: taper ? 0.7 : 0,
        smoothing: stroke.smoothing !== undefined ? stroke.smoothing : 0.5,
        streamline: stroke.streamline !== undefined ? stroke.streamline : 0.5,
        start: { taper: taper ? size : 0, easing: (t) => t },
        end: { taper: taper ? size : 0, easing: (t) => t }
    });
    
    if (outlinePoints.length < 3) return null;
    
    const triangles = triangulateStroke(outlinePoints);
    if (triangles.length === 0) return null;
    
    const vertexCount = triangles.length / 2;
    const positionData = new Float32Array(triangles);
    const colorData = new Float32Array(vertexCount * 4);
    
    let r = 1, g = 1, b = 1, a = 1;
    if (color && color.startsWith('#')) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    }
    
    if (stroke.type === 'eraser') {
        a = 0;
    }
    
    for (let i = 0; i < vertexCount; i++) {
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = a;
    }
    
    const positionBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = device.createBuffer({
        size: colorData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    return { positionBuffer, colorBuffer, vertexCount };
}

function renderShapeWebGPU(stroke, camera) {
    if (!device) return null;
    
    const triangles = [];
    const color = stroke.color || '#ffffff';
    
    let r = 1, g = 1, b = 1;
    if (color.startsWith('#')) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    }
    
    const shapeType = stroke.shapeType;
    const start = stroke.start;
    const end = stroke.end;
    const size = stroke.size || 2;
    
    if (!start || !end) return null;
    
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    
    const hw = size / 2;
    
    switch (shapeType) {
        case 'line':
        case 'arrow':
        case 'double-arrow':
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1) return null;
            
            const nx = -dy / len * hw;
            const ny = dx / len * hw;
            
            triangles.push(
                start.x + nx, start.y + ny,
                start.x - nx, start.y - ny,
                end.x - nx, end.y - ny,
                start.x + nx, start.y + ny,
                end.x - nx, end.y - ny,
                end.x + nx, end.y + ny
            );
            break;
            
        case 'rect':
            triangles.push(
                minX, minY,
                maxX, minY,
                maxX, maxY,
                minX, minY,
                maxX, maxY,
                minX, maxY
            );
            break;
            
        case 'circle':
        case 'ellipse':
            const cx = (start.x + end.x) / 2;
            const cy = (start.y + end.y) / 2;
            const rx = Math.abs(end.x - start.x) / 2;
            const ry = Math.abs(end.y - start.y) / 2;
            const segments = 32;
            
            for (let i = 0; i < segments; i++) {
                const a1 = (i / segments) * Math.PI * 2;
                const a2 = ((i + 1) / segments) * Math.PI * 2;
                
                triangles.push(
                    cx, cy,
                    cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry,
                    cx + Math.cos(a2) * rx, cy + Math.sin(a2) * ry
                );
            }
            break;
            
        default:
            return null;
    }
    
    if (triangles.length === 0) return null;
    
    const vertexCount = triangles.length / 2;
    const positionData = new Float32Array(triangles);
    const colorData = new Float32Array(vertexCount * 4);
    
    for (let i = 0; i < vertexCount; i++) {
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = 1.0;
    }
    
    const positionBuffer = device.createBuffer({
        size: positionData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = device.createBuffer({
        size: colorData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    return { positionBuffer, colorBuffer, vertexCount };
}

function renderCanvasWebGPU(canvas) {
    if (!device || !context || !pipeline) {
        return false;
    }
    
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Update canvas size if needed
    const currentSize = context.getCurrentTexture()?.width;
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);
    
    if (!currentSize || currentSize !== targetWidth) {
        context.configure({
            device: device,
            format: canvasFormat,
            alphaMode: 'premultiplied',
            size: {
                width: targetWidth,
                height: targetHeight
            }
        });
    }
    
    const camera = state.getActiveCamera();
    const strokes = state.getActiveStrokes();
    
    const uniformData = new Float32Array([
        width,
        height,
        camera.x,
        camera.y,
        camera.z * dpr,
        0,
        0,
        0
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    
    const commandEncoder = device.createCommandEncoder();
    
    const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
        }]
    });
    
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    
    if (!state.hideStrokes) {
        strokes.forEach(stroke => {
            let renderData = null;
            
            if (stroke.type === 'pen') {
                renderData = renderStrokeWebGPU(stroke, camera);
            } else if (stroke.type === 'shape') {
                renderData = renderShapeWebGPU(stroke, camera);
            }
            
            if (renderData && renderData.vertexCount > 0) {
                renderPass.setVertexBuffer(0, renderData.positionBuffer);
                renderPass.setVertexBuffer(1, renderData.colorBuffer);
                renderPass.draw(renderData.vertexCount);
            }
        });
    }
    
    if (state.isDrawing && state.currentTool === 'pen' && state.currentPoints.length > 0) {
        const previewStroke = {
            points: state.currentPoints,
            color: state.penColor,
            size: state.penSize,
            taper: state.penTaper
        };
        const renderData = renderStrokeWebGPU(previewStroke, camera);
        if (renderData && renderData.vertexCount > 0) {
            renderPass.setVertexBuffer(0, renderData.positionBuffer);
            renderPass.setVertexBuffer(1, renderData.colorBuffer);
            renderPass.draw(renderData.vertexCount);
        }
    }
    
    renderPass.end();
    
    device.queue.submit([commandEncoder.finish()]);
    
    return true;
}

function isAvailable() {
    return isInitialized && device !== null;
}

function cleanup() {
    if (device) {
        device.destroy();
        device = null;
    }
    context = null;
    pipeline = null;
    uniformBuffer = null;
    uniformBindGroup = null;
    isInitialized = false;
    initPromise = null;
}

module.exports = {
    initWebGPU,
    renderCanvasWebGPU,
    isAvailable,
    cleanup
};
